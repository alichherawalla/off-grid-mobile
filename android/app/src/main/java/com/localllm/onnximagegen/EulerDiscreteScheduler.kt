package com.localllm.onnximagegen

import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * Euler Discrete Scheduler for Stable Diffusion denoising.
 * Simpler and more reliable than LMS for mobile devices.
 * Also compatible with LCM models when using fewer steps.
 */
class EulerDiscreteScheduler(
    private val numTrainTimesteps: Int = 1000,
    private val betaStart: Float = 0.00085f,
    private val betaEnd: Float = 0.012f,
    private val betaSchedule: String = "scaled_linear"
) {
    private var numInferenceSteps: Int = 0
    private lateinit var timesteps: IntArray
    private lateinit var sigmas: FloatArray

    // Betas and alphas for the diffusion process
    private val betas: FloatArray
    private val alphas: FloatArray
    private val alphasCumprod: FloatArray

    init {
        // Calculate betas based on schedule
        betas = when (betaSchedule) {
            "scaled_linear" -> {
                val start = sqrt(betaStart.toDouble()).toFloat()
                val end = sqrt(betaEnd.toDouble()).toFloat()
                linspace(start, end, numTrainTimesteps).map { it * it }.toFloatArray()
            }
            "linear" -> linspace(betaStart, betaEnd, numTrainTimesteps).toFloatArray()
            else -> throw IllegalArgumentException("Unknown beta schedule: $betaSchedule")
        }

        // Calculate alphas
        alphas = betas.map { 1f - it }.toFloatArray()

        // Calculate cumulative product of alphas
        alphasCumprod = FloatArray(alphas.size)
        var cumprod = 1f
        for (i in alphas.indices) {
            cumprod *= alphas[i]
            alphasCumprod[i] = cumprod
        }
    }

    /**
     * Set the number of inference steps and prepare timesteps/sigmas
     */
    fun setTimesteps(numSteps: Int) {
        numInferenceSteps = numSteps

        // Create timesteps (evenly spaced from numTrainTimesteps-1 to 0)
        val stepRatio = numTrainTimesteps.toFloat() / numSteps
        timesteps = IntArray(numSteps) { i ->
            ((numSteps - 1 - i) * stepRatio).toInt().coerceIn(0, numTrainTimesteps - 1)
        }

        // Calculate sigmas from alphas_cumprod
        // sigma = sqrt((1 - alpha_cumprod) / alpha_cumprod)
        sigmas = FloatArray(numSteps + 1)
        for (i in 0 until numSteps) {
            val t = timesteps[i]
            sigmas[i] = sqrt((1f - alphasCumprod[t]) / alphasCumprod[t])
        }
        sigmas[numSteps] = 0f  // Final sigma is 0
    }

    /**
     * Get the current timesteps
     */
    fun getTimesteps(): IntArray = timesteps

    /**
     * Get sigma for a given step
     */
    fun getSigma(step: Int): Float = sigmas[step]

    /**
     * Get the initial noise sigma (for scaling input noise)
     */
    fun getInitNoiseSigma(): Float {
        val sigmaMax = sigmas[0]
        return sqrt(sigmaMax * sigmaMax + 1f)
    }

    /**
     * Scale the initial noise by the initial sigma
     */
    fun scaleInitialNoise(noise: FloatArray): FloatArray {
        val scale = getInitNoiseSigma()
        return noise.map { it * scale }.toFloatArray()
    }

    /**
     * Scale model input for the current timestep
     */
    fun scaleModelInput(sample: FloatArray, stepIndex: Int): FloatArray {
        val sigma = sigmas[stepIndex]
        val scale = 1f / sqrt(sigma * sigma + 1f)
        return sample.map { it * scale }.toFloatArray()
    }

    /**
     * Perform one denoising step using Euler method
     */
    fun step(
        modelOutput: FloatArray,
        timestepIndex: Int,
        sample: FloatArray
    ): FloatArray {
        val sigma = sigmas[timestepIndex]
        val sigmaNext = sigmas[timestepIndex + 1]

        // Euler method: x_next = x + (sigma_next - sigma) * model_output / sigma
        // Or equivalently for epsilon prediction:
        // pred_original = sample - sigma * model_output
        // derivative = (sample - pred_original) / sigma = model_output
        // x_next = sample + (sigma_next - sigma) * derivative

        val dt = sigmaNext - sigma

        return FloatArray(sample.size) { i ->
            sample[i] + dt * modelOutput[i]
        }
    }

    /**
     * Generate initial latent noise
     */
    fun generateNoise(
        batchSize: Int,
        channels: Int,
        height: Int,
        width: Int,
        seed: Long = System.currentTimeMillis()
    ): FloatArray {
        val random = Random(seed)
        val size = batchSize * channels * height * width
        return FloatArray(size) {
            // Box-Muller transform for Gaussian noise
            val u1 = random.nextFloat().coerceIn(1e-7f, 1f)
            val u2 = random.nextFloat()
            (sqrt(-2f * ln(u1.toDouble())) * kotlin.math.cos(2 * Math.PI * u2)).toFloat()
        }
    }

    /**
     * Get timestep for a step
     */
    fun getTimestep(stepIndex: Int): Int = timesteps[stepIndex]

    private fun linspace(start: Float, end: Float, steps: Int): List<Float> {
        if (steps == 1) return listOf(start)
        val step = (end - start) / (steps - 1)
        return List(steps) { i -> start + step * i }
    }
}
