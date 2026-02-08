import Foundation
import UIKit
import CoreML
import React
import StableDiffusion

/// React Native bridge for Apple's ml-stable-diffusion pipeline.
/// Mirrors the Android LocalDreamModule interface so the TypeScript layer
/// can use a single abstraction via Platform.select().
@objc(CoreMLDiffusionModule)
class CoreMLDiffusionModule: RCTEventEmitter {

  // MARK: - State

  private var pipeline: StableDiffusionPipeline?
  private var loadedModelPath: String?
  private var generating = false
  private var cancelRequested = false

  // Serial queue for all pipeline operations
  private let pipelineQueue = DispatchQueue(label: "com.localllm.coreml.diffusion", qos: .userInitiated)

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["LocalDreamProgress", "LocalDreamError"]
  }

  // MARK: - loadModel

  @objc func loadModel(_ params: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let modelPath = params["modelPath"] as? String else {
      reject("ERR_INVALID_PARAMS", "modelPath is required", nil)
      return
    }

    pipelineQueue.async { [weak self] in
      guard let self = self else { return }

      // Unload previous if different path
      if self.loadedModelPath != nil && self.loadedModelPath != modelPath {
        self.pipeline = nil
        self.loadedModelPath = nil
      }

      do {
        let url = URL(fileURLWithPath: modelPath)

        let config = MLModelConfiguration()
        config.computeUnits = .cpuAndNeuralEngine

        let pipe = try StableDiffusionPipeline(
          resourcesAt: url,
          controlNet: [],
          configuration: config,
          reduceMemory: true
        )

        try pipe.loadResources()

        self.pipeline = pipe
        self.loadedModelPath = modelPath
        resolve(true)
      } catch {
        reject("ERR_LOAD_FAILED", "Failed to load Core ML model: \(error.localizedDescription)", error)
      }
    }
  }

  // MARK: - unloadModel

  @objc func unloadModel(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    pipelineQueue.async { [weak self] in
      self?.pipeline = nil
      self?.loadedModelPath = nil
      resolve(true)
    }
  }

  // MARK: - isModelLoaded

  @objc func isModelLoaded(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(pipeline != nil)
  }

  // MARK: - getLoadedModelPath

  @objc func getLoadedModelPath(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(loadedModelPath as Any)
  }

  // MARK: - generateImage

  @objc func generateImage(_ params: NSDictionary,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let pipe = pipeline else {
      reject("ERR_NO_MODEL", "No model loaded", nil)
      return
    }

    guard !generating else {
      reject("ERR_BUSY", "Image generation already in progress", nil)
      return
    }

    let prompt = params["prompt"] as? String ?? ""
    let negativePrompt = params["negativePrompt"] as? String ?? ""
    let steps = params["steps"] as? Int ?? 20
    let guidanceScale = params["guidanceScale"] as? Double ?? 7.5
    let seed = params["seed"] as? UInt32 ?? UInt32.random(in: 0..<UInt32.max)

    generating = true
    cancelRequested = false

    pipelineQueue.async { [weak self] in
      guard let self = self else { return }

      defer { self.generating = false }

      do {
        var pipelineConfig = StableDiffusionPipeline.Configuration(prompt: prompt)
        pipelineConfig.negativePrompt = negativePrompt
        pipelineConfig.stepCount = steps
        pipelineConfig.guidanceScale = Float(guidanceScale)
        pipelineConfig.seed = seed

        let images = try pipe.generateImages(configuration: pipelineConfig) { progress in
          if self.cancelRequested { return false }

          let progressValue = Double(progress.step) / Double(progress.stepCount)
          self.sendEvent(withName: "LocalDreamProgress", body: [
            "step": progress.step,
            "totalSteps": progress.stepCount,
            "progress": progressValue,
          ])

          return true // continue
        }

        if self.cancelRequested {
          reject("ERR_CANCELLED", "Generation was cancelled", nil)
          return
        }

        guard let cgImage = images.compactMap({ $0 }).first else {
          reject("ERR_NO_IMAGE", "Pipeline produced no image", nil)
          return
        }

        // Save to app's documents directory
        let imageId = UUID().uuidString
        let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let generatedDir = docsDir.appendingPathComponent("generated_images")
        try FileManager.default.createDirectory(at: generatedDir, withIntermediateDirectories: true)

        let imagePath = generatedDir.appendingPathComponent("\(imageId).png")
        let uiImage = UIImage(cgImage: cgImage)
        guard let pngData = uiImage.pngData() else {
          reject("ERR_ENCODE", "Failed to encode image as PNG", nil)
          return
        }
        try pngData.write(to: imagePath)

        resolve([
          "id": imageId,
          "imagePath": imagePath.path,
          "width": cgImage.width,
          "height": cgImage.height,
          "seed": seed,
        ] as [String: Any])

      } catch {
        if !self.cancelRequested {
          self.sendEvent(withName: "LocalDreamError", body: [
            "error": error.localizedDescription,
          ])
          reject("ERR_GENERATION", "Image generation failed: \(error.localizedDescription)", error)
        } else {
          reject("ERR_CANCELLED", "Generation was cancelled", nil)
        }
      }
    }
  }

  // MARK: - cancelGeneration

  @objc func cancelGeneration(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    cancelRequested = true
    resolve(true)
  }

  // MARK: - isGenerating

  @objc func isGenerating(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(generating)
  }

  // MARK: - isNpuSupported (always true on Apple Silicon)

  @objc func isNpuSupported(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(true)
  }

  // MARK: - getGeneratedImages

  @objc func getGeneratedImages(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let generatedDir = docsDir.appendingPathComponent("generated_images")

    guard let files = try? FileManager.default.contentsOfDirectory(
      at: generatedDir, includingPropertiesForKeys: [.creationDateKey], options: .skipsHiddenFiles
    ) else {
      resolve([])
      return
    }

    let images: [[String: Any]] = files
      .filter { $0.pathExtension == "png" }
      .compactMap { url in
        let id = url.deletingPathExtension().lastPathComponent
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let createdAt = (attrs?[.creationDate] as? Date)?.iso8601String ?? ""

        return [
          "id": id,
          "prompt": "",
          "imagePath": url.path,
          "width": 512,
          "height": 512,
          "steps": 0,
          "seed": 0,
          "modelId": "",
          "createdAt": createdAt,
        ] as [String: Any]
      }

    resolve(images)
  }

  // MARK: - deleteGeneratedImage

  @objc func deleteGeneratedImage(_ imageId: String,
                                   resolver resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let imagePath = docsDir
      .appendingPathComponent("generated_images")
      .appendingPathComponent("\(imageId).png")

    do {
      try FileManager.default.removeItem(at: imagePath)
      resolve(true)
    } catch {
      resolve(false)
    }
  }
}

// MARK: - Date helper

private extension Date {
  var iso8601String: String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: self)
  }
}
