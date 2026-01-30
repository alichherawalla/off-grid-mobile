package com.localllm.onnximagegen

import android.graphics.Bitmap
import android.util.Log
import ai.onnxruntime.*
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.nio.LongBuffer
import java.util.UUID
import kotlinx.coroutines.*

/**
 * ONNX Runtime based image generator module for Stable Diffusion.
 * Replaces MediaPipe implementation which has issues on Adreno 750.
 */
class ONNXImageGeneratorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ONNXImageGenerator"
        private const val MODULE_NAME = "ONNXImageGeneratorModule"
        private const val EVENT_PROGRESS = "ONNXImageProgress"
        private const val EVENT_COMPLETE = "ONNXImageComplete"
        private const val EVENT_ERROR = "ONNXImageError"

        // Latent space dimensions for SD 1.5
        private const val LATENT_CHANNELS = 4
        private const val LATENT_SCALE = 8
        private const val VAE_SCALE_FACTOR = 0.18215f
    }

    private var ortEnv: OrtEnvironment? = null
    private var textEncoder: OrtSession? = null
    private var unet: OrtSession? = null
    private var vaeDecoder: OrtSession? = null
    private var tokenizer: CLIPTokenizer? = null
    private var scheduler: LMSDiscreteScheduler? = null

    private var currentModelPath: String? = null
    private var isGenerating = false
    private var shouldCancel = false
    private val coroutineScope = CoroutineScope(Dispatchers.Default + Job())

    override fun getName(): String = MODULE_NAME

    override fun getConstants(): Map<String, Any> {
        return mapOf(
            "DEFAULT_STEPS" to 20,
            "DEFAULT_GUIDANCE_SCALE" to 7.5,
            "DEFAULT_WIDTH" to 512,
            "DEFAULT_HEIGHT" to 512,
            "SUPPORTED_WIDTHS" to listOf(512),
            "SUPPORTED_HEIGHTS" to listOf(512)
        )
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun isModelLoaded(promise: Promise) {
        promise.resolve(textEncoder != null && unet != null && vaeDecoder != null)
    }

    @ReactMethod
    fun getLoadedModelPath(promise: Promise) {
        promise.resolve(currentModelPath)
    }

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        coroutineScope.launch {
            try {
                val modelDir = File(modelPath)
                if (!modelDir.exists() || !modelDir.isDirectory) {
                    promise.reject("MODEL_NOT_FOUND", "Model directory not found: $modelPath")
                    return@launch
                }

                // Verify required files exist
                val textEncoderPath = File(modelDir, "text_encoder/model.ort")
                val unetPath = File(modelDir, "unet/model.ort")
                val vaeDecoderPath = File(modelDir, "vae_decoder/model.ort")
                val tokenizerPath = File(modelDir, "tokenizer")

                val missingFiles = mutableListOf<String>()
                if (!textEncoderPath.exists()) missingFiles.add("text_encoder/model.ort")
                if (!unetPath.exists()) missingFiles.add("unet/model.ort")
                if (!vaeDecoderPath.exists()) missingFiles.add("vae_decoder/model.ort")
                if (!tokenizerPath.exists()) missingFiles.add("tokenizer/")

                if (missingFiles.isNotEmpty()) {
                    promise.reject("MISSING_FILES", "Missing model files: ${missingFiles.joinToString(", ")}")
                    return@launch
                }

                // Release existing models if different path
                if (currentModelPath != modelPath) {
                    releaseModels()
                }

                // Skip if already loaded
                if (textEncoder != null && currentModelPath == modelPath) {
                    promise.resolve(true)
                    return@launch
                }

                Log.d(TAG, "Loading ONNX models from: $modelPath")

                // Initialize ONNX Runtime environment
                if (ortEnv == null) {
                    ortEnv = OrtEnvironment.getEnvironment()
                }

                // Configure session options for mobile
                val sessionOptions = OrtSession.SessionOptions().apply {
                    // Use CPU provider (most compatible)
                    // NNAPI can be added for supported devices but may have compatibility issues
                    setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                    setIntraOpNumThreads(4)
                }

                // Load models
                Log.d(TAG, "Loading text encoder...")
                textEncoder = ortEnv!!.createSession(textEncoderPath.absolutePath, sessionOptions)

                Log.d(TAG, "Loading UNet...")
                unet = ortEnv!!.createSession(unetPath.absolutePath, sessionOptions)

                Log.d(TAG, "Loading VAE decoder...")
                vaeDecoder = ortEnv!!.createSession(vaeDecoderPath.absolutePath, sessionOptions)

                Log.d(TAG, "Loading tokenizer...")
                tokenizer = CLIPTokenizer(tokenizerPath.absolutePath)

                // Initialize scheduler
                scheduler = LMSDiscreteScheduler()

                currentModelPath = modelPath
                Log.d(TAG, "All models loaded successfully")

                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error loading models", e)
                releaseModels()
                promise.reject("LOAD_ERROR", "Failed to load models: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun unloadModel(promise: Promise) {
        try {
            releaseModels()
            currentModelPath = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", "Failed to unload models: ${e.message}", e)
        }
    }

    private fun releaseModels() {
        textEncoder?.close()
        textEncoder = null
        unet?.close()
        unet = null
        vaeDecoder?.close()
        vaeDecoder = null
        tokenizer = null
        scheduler = null
    }

    @ReactMethod
    fun generateImage(params: ReadableMap, promise: Promise) {
        if (textEncoder == null || unet == null || vaeDecoder == null || tokenizer == null) {
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
        val guidanceScale = if (params.hasKey("guidanceScale")) params.getDouble("guidanceScale").toFloat() else 7.5f
        val seed = if (params.hasKey("seed")) params.getInt("seed").toLong() else System.currentTimeMillis()
        val width = if (params.hasKey("width")) params.getInt("width") else 512
        val height = if (params.hasKey("height")) params.getInt("height") else 512

        isGenerating = true
        shouldCancel = false

        coroutineScope.launch {
            try {
                Log.d(TAG, "Starting image generation - Prompt: $prompt, Steps: $steps")

                val startTime = System.currentTimeMillis()

                // Send initial progress
                sendProgress(0, steps)

                // 1. Tokenize prompts
                val promptTokens = tokenizer!!.encode(prompt)
                val negativeTokens = tokenizer!!.encode(negativePrompt)

                // 2. Get text embeddings
                Log.d(TAG, "Encoding prompt tokens: ${promptTokens.size}")
                val textEmbeddings = encodeText(promptTokens)
                Log.d(TAG, "Text embeddings size: ${textEmbeddings.size}")

                val uncondEmbeddings = encodeText(negativeTokens)
                Log.d(TAG, "Uncond embeddings size: ${uncondEmbeddings.size}")

                // Concatenate for classifier-free guidance [uncond, cond]
                val batchEmbeddings = concatenateEmbeddings(uncondEmbeddings, textEmbeddings)
                Log.d(TAG, "Batch embeddings size: ${batchEmbeddings.size}")

                // 3. Initialize latents
                val latentHeight = height / LATENT_SCALE
                val latentWidth = width / LATENT_SCALE
                scheduler!!.setTimesteps(steps)

                var latents = scheduler!!.generateNoise(1, LATENT_CHANNELS, latentHeight, latentWidth, seed)
                latents = scheduler!!.scaleInitialNoise(latents)

                // 4. Denoising loop
                val timesteps = scheduler!!.getTimesteps()
                Log.d(TAG, "Starting denoising with ${timesteps.size} steps")
                Log.d(TAG, "Timesteps: ${timesteps.take(5).toList()}...")
                Log.d(TAG, "Initial latents - min: ${latents.minOrNull()}, max: ${latents.maxOrNull()}, mean: ${latents.average()}")

                for ((stepIndex, timestep) in timesteps.withIndex()) {
                    if (shouldCancel) {
                        throw Exception("Generation cancelled")
                    }

                    // Duplicate latents for classifier-free guidance
                    val latentModelInput = duplicateLatents(latents)

                    // Predict noise
                    val noisePred = predictNoise(latentModelInput, timestep.toLong(), batchEmbeddings)

                    if (stepIndex == 0) {
                        Log.d(TAG, "Step 0 - Noise pred size: ${noisePred.size}, min: ${noisePred.minOrNull()}, max: ${noisePred.maxOrNull()}")
                    }

                    // Perform guidance
                    val guidedNoise = applyGuidance(noisePred, guidanceScale)

                    // Scheduler step
                    latents = scheduler!!.step(guidedNoise, stepIndex, latents)

                    if (stepIndex == 0 || stepIndex == steps - 1) {
                        Log.d(TAG, "Step $stepIndex - Latents min: ${latents.minOrNull()}, max: ${latents.maxOrNull()}, mean: ${latents.average()}")
                    }

                    // Send progress
                    sendProgress(stepIndex + 1, steps)
                }

                Log.d(TAG, "Final latents - min: ${latents.minOrNull()}, max: ${latents.maxOrNull()}, mean: ${latents.average()}")

                // 5. Decode latents to image
                val image = decodeLatents(latents, height, width)

                // 6. Save image
                val outputDir = File(reactApplicationContext.filesDir, "generated_images")
                if (!outputDir.exists()) {
                    outputDir.mkdirs()
                }

                val imageId = UUID.randomUUID().toString()
                val outputFile = File(outputDir, "$imageId.png")

                FileOutputStream(outputFile).use { outputStream ->
                    image.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
                }

                val elapsedTime = (System.currentTimeMillis() - startTime) / 1000f
                Log.d(TAG, "Image generated in ${elapsedTime}s, saved to: ${outputFile.absolutePath}")

                val resultMap = Arguments.createMap().apply {
                    putString("id", imageId)
                    putString("imagePath", outputFile.absolutePath)
                    putString("prompt", prompt)
                    putString("negativePrompt", negativePrompt)
                    putInt("width", width)
                    putInt("height", height)
                    putInt("steps", steps)
                    putDouble("seed", seed.toDouble())
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

    private fun sendProgress(step: Int, totalSteps: Int) {
        val progressMap = Arguments.createMap().apply {
            putInt("step", step)
            putInt("totalSteps", totalSteps)
            putDouble("progress", step.toDouble() / totalSteps)
        }
        sendEvent(EVENT_PROGRESS, progressMap)
    }

    private fun encodeText(tokenIds: IntArray): FloatArray {
        val env = ortEnv!!
        val session = textEncoder!!

        // Create input tensor - convert to Long as many CLIP models expect int64
        val tokenLongs = tokenIds.map { it.toLong() }.toLongArray()
        val tokenBuffer = LongBuffer.wrap(tokenLongs)
        val inputTensor = OnnxTensor.createTensor(env, tokenBuffer, longArrayOf(1, tokenIds.size.toLong()))

        // Run inference - try different input names
        val inputName = session.inputNames.firstOrNull() ?: "input_ids"
        val inputs = mapOf(inputName to inputTensor)
        val outputs = session.run(inputs)

        // Get output - properly extract data from buffer
        val outputTensor = outputs.get(0) as OnnxTensor
        val outputData = extractFloatArray(outputTensor)

        inputTensor.close()
        outputs.close()

        return outputData
    }

    private fun extractFloatArray(tensor: OnnxTensor): FloatArray {
        val buffer = tensor.floatBuffer
        val data = FloatArray(buffer.remaining())
        buffer.get(data)
        return data
    }

    private fun extractIntArray(tensor: OnnxTensor): IntArray {
        val buffer = tensor.intBuffer
        val data = IntArray(buffer.remaining())
        buffer.get(data)
        return data
    }

    private fun concatenateEmbeddings(uncond: FloatArray, cond: FloatArray): FloatArray {
        return uncond + cond
    }

    private fun duplicateLatents(latents: FloatArray): FloatArray {
        return latents + latents  // [latents, latents] for batch of 2
    }

    private fun predictNoise(latents: FloatArray, timestep: Long, embeddings: FloatArray): FloatArray {
        val env = ortEnv!!
        val session = unet!!

        // Get latent shape from size (assuming batch=2 for classifier-free guidance)
        val batchSize = 2
        val channels = LATENT_CHANNELS
        val height = 64  // 512 / 8
        val width = 64

        // Log input names for debugging
        Log.d(TAG, "UNet input names: ${session.inputNames.toList()}")

        // Create latent tensor
        val latentBuffer = FloatBuffer.wrap(latents)
        val latentTensor = OnnxTensor.createTensor(
            env, latentBuffer,
            longArrayOf(batchSize.toLong(), channels.toLong(), height.toLong(), width.toLong())
        )

        // Create timestep tensor - use int64 as expected by most diffusers models
        // Shape can be [batch] or [1] depending on model
        val timestepArray = longArrayOf(timestep, timestep)
        val timestepBuffer = LongBuffer.wrap(timestepArray)
        val timestepTensor = OnnxTensor.createTensor(env, timestepBuffer, longArrayOf(batchSize.toLong()))

        // Create encoder hidden states tensor
        val embeddingBuffer = FloatBuffer.wrap(embeddings)
        val seqLen = 77L  // CLIP max length
        val hiddenSize = embeddings.size / (batchSize * 77)
        Log.d(TAG, "Embedding hidden size: $hiddenSize, total size: ${embeddings.size}")
        val embeddingTensor = OnnxTensor.createTensor(
            env, embeddingBuffer,
            longArrayOf(batchSize.toLong(), seqLen, hiddenSize.toLong())
        )

        // Build inputs map based on actual model input names
        val inputNames = session.inputNames.toList()
        val inputs = mutableMapOf<String, OnnxTensor>()

        // Find the right input names (models may use different naming conventions)
        for (name in inputNames) {
            when {
                name.contains("sample") || name.contains("latent") -> inputs[name] = latentTensor
                name.contains("timestep") || name == "t" -> inputs[name] = timestepTensor
                name.contains("encoder") || name.contains("hidden") || name.contains("context") -> inputs[name] = embeddingTensor
            }
        }

        // Fallback to standard names if no matches found
        if (inputs.isEmpty()) {
            inputs["sample"] = latentTensor
            inputs["timestep"] = timestepTensor
            inputs["encoder_hidden_states"] = embeddingTensor
        }

        Log.d(TAG, "UNet inputs: ${inputs.keys.toList()}")

        val outputs = session.run(inputs)

        // Get output - properly extract data
        val outputTensor = outputs.get(0) as OnnxTensor
        val outputData = extractFloatArray(outputTensor)

        latentTensor.close()
        timestepTensor.close()
        embeddingTensor.close()
        outputs.close()

        return outputData
    }

    private fun applyGuidance(noisePred: FloatArray, guidanceScale: Float): FloatArray {
        // Split into unconditional and conditional predictions
        val halfSize = noisePred.size / 2
        val noiseUncond = noisePred.sliceArray(0 until halfSize)
        val noiseCond = noisePred.sliceArray(halfSize until noisePred.size)

        // Apply classifier-free guidance
        return FloatArray(halfSize) { i ->
            noiseUncond[i] + guidanceScale * (noiseCond[i] - noiseUncond[i])
        }
    }

    private fun decodeLatents(latents: FloatArray, height: Int, width: Int): Bitmap {
        val env = ortEnv!!
        val session = vaeDecoder!!

        Log.d(TAG, "VAE decoder input names: ${session.inputNames.toList()}")

        // Scale latents (1 / 0.18215 ≈ 5.4885)
        val scaledLatents = latents.map { it / VAE_SCALE_FACTOR }.toFloatArray()

        // Create input tensor
        val latentHeight = height / LATENT_SCALE
        val latentWidth = width / LATENT_SCALE
        val latentBuffer = FloatBuffer.wrap(scaledLatents)
        val latentTensor = OnnxTensor.createTensor(
            env, latentBuffer,
            longArrayOf(1, LATENT_CHANNELS.toLong(), latentHeight.toLong(), latentWidth.toLong())
        )

        // Find the right input name
        val inputName = session.inputNames.firstOrNull() ?: "latent_sample"
        val inputs = mapOf(inputName to latentTensor)
        val outputs = session.run(inputs)

        // Get output image - properly extract data
        val outputTensor = outputs.get(0) as OnnxTensor
        val imageData = extractFloatArray(outputTensor)

        Log.d(TAG, "VAE output size: ${imageData.size}, expected: ${3 * height * width}")

        latentTensor.close()
        outputs.close()

        // Convert to bitmap
        return floatArrayToBitmap(imageData, height, width)
    }

    private fun floatArrayToBitmap(data: FloatArray, height: Int, width: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(width * height)

        for (y in 0 until height) {
            for (x in 0 until width) {
                val idx = y * width + x

                // Data is in CHW format (3, H, W)
                val r = ((data[idx] + 1f) / 2f * 255f).toInt().coerceIn(0, 255)
                val g = ((data[width * height + idx] + 1f) / 2f * 255f).toInt().coerceIn(0, 255)
                val b = ((data[2 * width * height + idx] + 1f) / 2f * 255f).toInt().coerceIn(0, 255)

                pixels[idx] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
        }

        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }

    @ReactMethod
    fun cancelGeneration(promise: Promise) {
        shouldCancel = true
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
        releaseModels()
        ortEnv?.close()
        ortEnv = null
    }
}
