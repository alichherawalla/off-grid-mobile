package com.localllm.onnximagegen

import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * LMS Discrete Scheduler for Stable Diffusion denoising.
 * Based on the Latent Diffusion paper and sd4j reference implementation.
 */
class LMSDiscreteScheduler(
    private val numTrainTimesteps: Int = 1000,
    private val betaStart: Float = 0.00085f,
    private val betaEnd: Float = 0.012f,
    private val betaSchedule: String = "scaled_linear"
) {
    private var numInferenceSteps: Int = 0
    private lateinit var timesteps: IntArray
    private lateinit var sigmas: FloatArray
    private val derivatives: MutableList<FloatArray> = mutableListOf()

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
        derivatives.clear()

        // Create timesteps (evenly spaced from numTrainTimesteps-1 to 0)
        val stepRatio = numTrainTimesteps / numSteps
        timesteps = IntArray(numSteps) { i ->
            ((numSteps - 1 - i) * stepRatio).coerceIn(0, numTrainTimesteps - 1)
        }

        // Calculate sigmas
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
     * Scale the initial noise by the initial sigma
     */
    fun scaleInitialNoise(noise: FloatArray): FloatArray {
        val scale = sigmas[0]
        return noise.map { it * scale }.toFloatArray()
    }

    /**
     * Perform one denoising step using Linear Multi-Step method
     */
    fun step(
        modelOutput: FloatArray,
        timestepIndex: Int,
        sample: FloatArray,
        order: Int = 4
    ): FloatArray {
        val sigma = sigmas[timestepIndex]
        val sigmaNext = sigmas[timestepIndex + 1]

        // Compute predicted original sample (x0)
        val predOriginalSample = FloatArray(sample.size) { i ->
            sample[i] - sigma * modelOutput[i]
        }

        // Compute derivative
        val derivative = FloatArray(sample.size) { i ->
            (sample[i] - predOriginalSample[i]) / sigma
        }

        // Store derivative for multi-step method
        derivatives.add(derivative)
        if (derivatives.size > order) {
            derivatives.removeAt(0)
        }

        // Use LMS method based on available derivatives
        val effectiveOrder = minOf(timestepIndex + 1, order, derivatives.size)

        return when (effectiveOrder) {
            1 -> lmsStep1(sample, derivative, sigma, sigmaNext)
            2 -> lmsStep2(sample, sigma, sigmaNext)
            3 -> lmsStep3(sample, sigma, sigmaNext)
            else -> lmsStep4(sample, sigma, sigmaNext)
        }
    }

    private fun lmsStep1(
        sample: FloatArray,
        derivative: FloatArray,
        sigma: Float,
        sigmaNext: Float
    ): FloatArray {
        val dt = sigmaNext - sigma
        return FloatArray(sample.size) { i ->
            sample[i] + dt * derivative[i]
        }
    }

    private fun lmsStep2(
        sample: FloatArray,
        sigma: Float,
        sigmaNext: Float
    ): FloatArray {
        val dt = sigmaNext - sigma
        val d0 = derivatives[derivatives.size - 1]
        val d1 = derivatives[derivatives.size - 2]

        return FloatArray(sample.size) { i ->
            sample[i] + dt * (1.5f * d0[i] - 0.5f * d1[i])
        }
    }

    private fun lmsStep3(
        sample: FloatArray,
        sigma: Float,
        sigmaNext: Float
    ): FloatArray {
        val dt = sigmaNext - sigma
        val d0 = derivatives[derivatives.size - 1]
        val d1 = derivatives[derivatives.size - 2]
        val d2 = derivatives[derivatives.size - 3]

        return FloatArray(sample.size) { i ->
            sample[i] + dt * ((23f / 12f) * d0[i] - (16f / 12f) * d1[i] + (5f / 12f) * d2[i])
        }
    }

    private fun lmsStep4(
        sample: FloatArray,
        sigma: Float,
        sigmaNext: Float
    ): FloatArray {
        val dt = sigmaNext - sigma
        val d0 = derivatives[derivatives.size - 1]
        val d1 = derivatives[derivatives.size - 2]
        val d2 = derivatives[derivatives.size - 3]
        val d3 = derivatives[derivatives.size - 4]

        return FloatArray(sample.size) { i ->
            sample[i] + dt * (
                (55f / 24f) * d0[i] -
                (59f / 24f) * d1[i] +
                (37f / 24f) * d2[i] -
                (9f / 24f) * d3[i]
            )
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
     * Get timestep tensor for a step
     */
    fun getTimestepTensor(stepIndex: Int): Long {
        return timesteps[stepIndex].toLong()
    }

    private fun linspace(start: Float, end: Float, steps: Int): List<Float> {
        if (steps == 1) return listOf(start)
        val step = (end - start) / (steps - 1)
        return List(steps) { i -> start + step * i }
    }
}
