package com.localllm.imagegen

import android.graphics.Bitmap
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mediapipe.tasks.vision.imagegenerator.ImageGenerator
import com.google.mediapipe.tasks.vision.imagegenerator.ImageGenerator.ImageGeneratorOptions
import com.google.mediapipe.framework.image.BitmapExtractor
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.*

class ImageGeneratorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ImageGeneratorModule"
        private const val MODULE_NAME = "ImageGeneratorModule"
        private const val EVENT_PROGRESS = "ImageGenerationProgress"
        private const val EVENT_COMPLETE = "ImageGenerationComplete"
        private const val EVENT_ERROR = "ImageGenerationError"
    }

    private var imageGenerator: ImageGenerator? = null
    private var currentModelPath: String? = null
    private var isGenerating = false
    private val coroutineScope = CoroutineScope(Dispatchers.Default + Job())

    override fun getName(): String = MODULE_NAME

    override fun getConstants(): Map<String, Any> {
        return mapOf(
            "DEFAULT_STEPS" to 20,
            "DEFAULT_GUIDANCE_SCALE" to 7.5,
            "DEFAULT_WIDTH" to 512,
            "DEFAULT_HEIGHT" to 512,
            "SUPPORTED_WIDTHS" to listOf(512, 768),
            "SUPPORTED_HEIGHTS" to listOf(512, 768)
        )
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun isModelLoaded(promise: Promise) {
        promise.resolve(imageGenerator != null)
    }

    @ReactMethod
    fun getLoadedModelPath(promise: Promise) {
        promise.resolve(currentModelPath)
    }

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        coroutineScope.launch {
            try {
                // Check if model directory exists
                val modelDir = File(modelPath)
                if (!modelDir.exists() || !modelDir.isDirectory) {
                    promise.reject("MODEL_NOT_FOUND", "Model directory not found: $modelPath")
                    return@launch
                }

                // Release existing generator if different model
                if (imageGenerator != null && currentModelPath != modelPath) {
                    imageGenerator?.close()
                    imageGenerator = null
                }

                // Skip if already loaded
                if (imageGenerator != null && currentModelPath == modelPath) {
                    promise.resolve(true)
                    return@launch
                }

                Log.d(TAG, "Loading model from: $modelPath")

                val options = ImageGeneratorOptions.builder()
                    .setImageGeneratorModelDirectory(modelPath)
                    .build()

                imageGenerator = ImageGenerator.createFromOptions(
                    reactApplicationContext,
                    options
                )

                currentModelPath = modelPath
                Log.d(TAG, "Model loaded successfully")

                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error loading model", e)
                promise.reject("LOAD_ERROR", "Failed to load model: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun unloadModel(promise: Promise) {
        try {
            imageGenerator?.close()
            imageGenerator = null
            currentModelPath = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", "Failed to unload model: ${e.message}", e)
        }
    }

    @ReactMethod
    fun generateImage(params: ReadableMap, promise: Promise) {
        if (imageGenerator == null) {
            promise.reject("NO_MODEL", "No model loaded. Call loadModel first.")
            return
        }

        if (isGenerating) {
            promise.reject("BUSY", "Image generation already in progress")
            return
        }

        val prompt = params.getString("prompt") ?: ""
        val negativePrompt = params.getString("negativePrompt") ?: ""
        val steps = if (params.hasKey("steps")) params.getInt("steps") else 20
        val guidanceScale = if (params.hasKey("guidanceScale")) params.getDouble("guidanceScale") else 7.5
        val seed = if (params.hasKey("seed")) params.getInt("seed") else (Math.random() * Int.MAX_VALUE).toInt()
        val width = if (params.hasKey("width")) params.getInt("width") else 512
        val height = if (params.hasKey("height")) params.getInt("height") else 512

        isGenerating = true

        coroutineScope.launch {
            try {
                Log.d(TAG, "Starting image generation - Prompt: $prompt, Steps: $steps")

                // Send initial progress
                val startProgress = Arguments.createMap().apply {
                    putInt("step", 0)
                    putInt("totalSteps", steps)
                    putDouble("progress", 0.0)
                }
                sendEvent(EVENT_PROGRESS, startProgress)

                // Generate the image using MediaPipe
                // Note: MediaPipe's generate method takes (prompt, iterations, seed)
                val result = imageGenerator?.generate(prompt, steps, seed)

                if (result == null) {
                    throw Exception("Image generation returned null result")
                }

                // Get the generated MPImage from the result
                val mpImage = result.generatedImage()

                if (mpImage == null) {
                    throw Exception("Generated image is null")
                }

                // Convert MPImage to Bitmap
                val generatedBitmap: Bitmap = BitmapExtractor.extract(mpImage)

                // Save the generated image
                val outputDir = File(reactApplicationContext.filesDir, "generated_images")
                if (!outputDir.exists()) {
                    outputDir.mkdirs()
                }

                val imageId = UUID.randomUUID().toString()
                val outputFile = File(outputDir, "$imageId.png")

                FileOutputStream(outputFile).use { outputStream: FileOutputStream ->
                    generatedBitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
                }

                Log.d(TAG, "Image saved to: ${outputFile.absolutePath}")

                val resultMap = Arguments.createMap().apply {
                    putString("id", imageId)
                    putString("imagePath", outputFile.absolutePath)
                    putString("prompt", prompt)
                    putString("negativePrompt", negativePrompt)
                    putInt("width", generatedBitmap.width)
                    putInt("height", generatedBitmap.height)
                    putInt("steps", steps)
                    putInt("seed", seed)
                    putString("createdAt", System.currentTimeMillis().toString())
                }

                isGenerating = false
                promise.resolve(resultMap)

                sendEvent(EVENT_COMPLETE, resultMap)

            } catch (e: Exception) {
                Log.e(TAG, "Error generating image", e)
                isGenerating = false

                val errorParams = Arguments.createMap().apply {
                    putString("error", e.message)
                }
                sendEvent(EVENT_ERROR, errorParams)

                promise.reject("GENERATION_ERROR", "Failed to generate image: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun cancelGeneration(promise: Promise) {
        // MediaPipe doesn't have a built-in cancel mechanism
        // We just mark as not generating and let current operation complete
        isGenerating = false
        promise.resolve(true)
    }

    @ReactMethod
    fun isGenerating(promise: Promise) {
        promise.resolve(isGenerating)
    }

    @ReactMethod
    fun getGeneratedImages(promise: Promise) {
        try {
            val outputDir = File(reactApplicationContext.filesDir, "generated_images")
            if (!outputDir.exists()) {
                promise.resolve(Arguments.createArray())
                return
            }

            val images = Arguments.createArray()
            outputDir.listFiles()?.filter { it.extension == "png" }?.forEach { file ->
                val imageMap = Arguments.createMap().apply {
                    putString("id", file.nameWithoutExtension)
                    putString("imagePath", file.absolutePath)
                    putDouble("size", file.length().toDouble())
                    putString("createdAt", file.lastModified().toString())
                }
                images.pushMap(imageMap)
            }

            promise.resolve(images)
        } catch (e: Exception) {
            promise.reject("LIST_ERROR", "Failed to list generated images: ${e.message}", e)
        }
    }

    @ReactMethod
    fun deleteGeneratedImage(imageId: String, promise: Promise) {
        try {
            val outputDir = File(reactApplicationContext.filesDir, "generated_images")
            val imageFile = File(outputDir, "$imageId.png")

            if (imageFile.exists()) {
                imageFile.delete()
                promise.resolve(true)
            } else {
                promise.reject("NOT_FOUND", "Image not found: $imageId")
            }
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", "Failed to delete image: ${e.message}", e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN event emitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN event emitter
    }

    override fun invalidate() {
        super.invalidate()
        coroutineScope.cancel()
        imageGenerator?.close()
        imageGenerator = null
    }
}
