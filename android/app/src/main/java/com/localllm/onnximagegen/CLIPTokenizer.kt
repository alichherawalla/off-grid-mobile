package com.localllm.onnximagegen

import android.util.Log
import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.regex.Pattern

/**
 * CLIP Tokenizer for encoding text prompts for Stable Diffusion.
 * Uses vocab.json and merges.txt files from the tokenizer directory.
 */
class CLIPTokenizer(tokenizerPath: String) {
    companion object {
        private const val TAG = "CLIPTokenizer"
        private const val PAD_TOKEN = "<|endoftext|>"
        private const val BOS_TOKEN = "<|startoftext|>"
        private const val EOS_TOKEN = "<|endoftext|>"
        private const val MAX_LENGTH = 77  // CLIP's max sequence length
    }

    private val vocab: Map<String, Int>
    private val merges: List<Pair<String, String>>
    private val bpeRanks: Map<Pair<String, String>, Int>
    private val pattern: Pattern
    private val padTokenId: Int
    private val bosTokenId: Int
    private val eosTokenId: Int

    init {
        // Load vocab.json
        val vocabFile = File(tokenizerPath, "vocab.json")
        if (!vocabFile.exists()) {
            throw IllegalArgumentException("vocab.json not found in $tokenizerPath")
        }
        val vocabJson = JSONObject(vocabFile.readText(StandardCharsets.UTF_8))
        vocab = mutableMapOf<String, Int>().apply {
            vocabJson.keys().forEach { key ->
                put(key, vocabJson.getInt(key))
            }
        }

        // Load merges.txt
        val mergesFile = File(tokenizerPath, "merges.txt")
        if (!mergesFile.exists()) {
            throw IllegalArgumentException("merges.txt not found in $tokenizerPath")
        }
        val mergeLines = mergesFile.readLines(StandardCharsets.UTF_8)
            .drop(1)  // Skip header line
            .filter { it.isNotBlank() }

        merges = mergeLines.map { line ->
            val parts = line.split(" ")
            Pair(parts[0], parts[1])
        }

        bpeRanks = merges.mapIndexed { index, pair -> pair to index }.toMap()

        // Get special token IDs
        padTokenId = vocab[PAD_TOKEN] ?: 49407
        bosTokenId = vocab[BOS_TOKEN] ?: 49406
        eosTokenId = vocab[EOS_TOKEN] ?: 49407

        // Pattern for tokenization (similar to CLIP's regex)
        pattern = Pattern.compile(
            """<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""",
            Pattern.CASE_INSENSITIVE
        )

        Log.d(TAG, "Tokenizer initialized with ${vocab.size} vocab entries and ${merges.size} merges")
    }

    /**
     * Encode text to token IDs
     */
    fun encode(text: String): IntArray {
        val tokens = tokenize(text.lowercase())
        val tokenIds = mutableListOf<Int>()

        // Add BOS token
        tokenIds.add(bosTokenId)

        // Convert tokens to IDs
        for (token in tokens) {
            val tokenWithSuffix = "$token</w>"
            val id = vocab[tokenWithSuffix] ?: vocab[token] ?: continue
            tokenIds.add(id)
        }

        // Add EOS token
        tokenIds.add(eosTokenId)

        // Pad or truncate to MAX_LENGTH
        return when {
            tokenIds.size >= MAX_LENGTH -> tokenIds.take(MAX_LENGTH).toIntArray()
            else -> {
                val padded = tokenIds.toMutableList()
                while (padded.size < MAX_LENGTH) {
                    padded.add(padTokenId)
                }
                padded.toIntArray()
            }
        }
    }

    /**
     * Tokenize text using BPE
     */
    private fun tokenize(text: String): List<String> {
        val tokens = mutableListOf<String>()
        val matcher = pattern.matcher(text)

        while (matcher.find()) {
            val word = matcher.group()
            val bpeTokens = bpe(word)
            tokens.addAll(bpeTokens)
        }

        return tokens
    }

    /**
     * Apply BPE to a word
     */
    private fun bpe(word: String): List<String> {
        if (word.isEmpty()) return emptyList()

        var wordChars = word.map { it.toString() }.toMutableList()

        while (wordChars.size > 1) {
            // Find the pair with the lowest rank
            var minPair: Pair<String, String>? = null
            var minRank = Int.MAX_VALUE

            for (i in 0 until wordChars.size - 1) {
                val pair = Pair(wordChars[i], wordChars[i + 1])
                val rank = bpeRanks[pair]
                if (rank != null && rank < minRank) {
                    minRank = rank
                    minPair = pair
                }
            }

            if (minPair == null) break

            // Merge the pair
            val newWordChars = mutableListOf<String>()
            var i = 0
            while (i < wordChars.size) {
                if (i < wordChars.size - 1 &&
                    wordChars[i] == minPair.first &&
                    wordChars[i + 1] == minPair.second) {
                    newWordChars.add(minPair.first + minPair.second)
                    i += 2
                } else {
                    newWordChars.add(wordChars[i])
                    i++
                }
            }
            wordChars = newWordChars
        }

        return wordChars
    }

    /**
     * Create attention mask for the given token IDs
     */
    fun createAttentionMask(tokenIds: IntArray): IntArray {
        return tokenIds.map { if (it != padTokenId) 1 else 0 }.toIntArray()
    }

    /**
     * Encode with unconditional (empty) prompt for classifier-free guidance
     */
    fun encodeUnconditional(): IntArray {
        return encode("")
    }
}
