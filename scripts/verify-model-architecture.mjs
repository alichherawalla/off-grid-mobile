#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { temporaryModelArchitectureAllowlist } from './model-architecture-allowlist.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return []
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolute)
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)
      ? [absolute]
      : []
  })
}

const files = [path.join(repoRoot, 'src'), path.join(repoRoot, 'pro')]
  .filter(fs.existsSync)
  .flatMap(sourceFiles)
const relative = file => path.relative(repoRoot, file).replaceAll(path.sep, '/')
const nodeText = (source, node) => node.getText(source).replace(/\s+/g, ' ')
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
const keyOf = finding => `${finding.rule}|${finding.file}|${finding.detail}`
const findings = []
const selectionProjectionKeys = new Set([
  'activeModelId', 'lastTextModelId', 'activeImageModelId', 'activeServerId',
  'activeRemoteTextModelId', 'activeRemoteImageModelId',
  'activeRemoteMediaServerIds', 'downloadedModelId', 'classifierModelId',
])

function assignedSelectionKeys(node) {
  const keys = []
  const inspect = candidate => {
    if (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) {
      const name = candidate.name && (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name))
        ? candidate.name.text
        : ''
      if (selectionProjectionKeys.has(name)) keys.push(name)
    }
    ts.forEachChild(candidate, inspect)
  }
  inspect(node)
  return keys
}

function report(rule, file, source, node, detail) {
  findings.push({ rule, file, line: lineOf(source, node), detail })
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const fileName = relative(file)
  const isUi = /^src\/(components|hooks|screens)\//.test(fileName)
  const isAdapter = /^src\/services\/(adapters|modelServices\/.*Adapter|.*Provider)/i.test(fileName)

  if (fileName === 'src/services/modelServices/remoteImageGeneration.ts') {
    report('mobile-image-lifecycle-is-shared', fileName, source, source, 'file:remoteImageGeneration')
  }

  if (/^src\/services\/(?:llmToolGeneration|litertToolSelector|toolEmbeddingRouter|toolCapabilityPreflight)\.ts$/.test(fileName)) {
    report('mobile-tool-routing-is-shared', fileName, source, source, `file:${path.basename(fileName)}`)
  }

  if (/^src\/(?:constants\/models|services\/(?:curatedLiteRTRegistry|whisperModels))\.ts$/.test(fileName)) {
    report('mobile-catalog-policy-is-shared', fileName, source, source, `file:${path.basename(fileName)}`)
  }

  if (fileName === 'src/services/adapters/remote/serverDiscovery.ts' && /\/v1\/models|\/api\/tags/.test(text)) {
    report('remote-discovery-policy-is-shared', fileName, source, source, 'literal:endpoint-order')
  }

  if (
    fileName === 'src/stores/whisperStore.ts' &&
    /\b(?:downloadModel|selectModel|loadModel|unloadModel|deleteModel|deleteModelById|refreshPresentModels)\s*:/.test(text)
  ) {
    report('transcription-workflow-is-shared', fileName, source, source, 'store:actionable-workflow')
  }

  if (
    fileName === 'src/services/modelServices/modelLifecycleBootstrap.ts' &&
    /\bpending(?:Text|Image|Transcription)ModelId\b/.test(text)
  ) {
    report('residency-workflow-is-shared', fileName, source, source, 'module-global:pending-model-id')
  }

  if (
    fileName === 'pro/audio/ttsStore.ts' &&
    /\b(?:ttsRegistry|modelResidencyManager|withVoiceSwitchTimeout|completedVoiceAssets|engine\.(?:setVoice|initialize|release|downloadAssets|deleteAssets|generateAndSave))\b/.test(text)
  ) {
    report('voice-control-plane-is-shared', fileName, source, source, 'store:voice-workflow')
  }

  if (
    fileName === 'pro/audio/ttsPlayback.ts' &&
    /\b(?:AbortController|dispatchPlayback|playbackStatus\s*[!=]=|currentMessageId\s*[!=]=)\b/.test(text)
  ) {
    report('voice-playback-control-is-shared', fileName, source, source, 'adapter:playback-state-machine')
  }

  if (
    fileName === 'pro/audio/ttsDownloadActions.ts' &&
    /\b(?:downloadAssets|deleteAssets|modelDownloaded|voiceAssetsDownloaded|modelResidencyManager)\b/.test(text)
  ) {
    report('voice-download-workflow-is-shared', fileName, source, source, 'adapter:download-policy')
  }

  if (
    fileName === 'pro/audio/voiceGenerationPort.ts' &&
    /\b(?:engine\.speak|initializeEngine|reconcileDownloadedFromPersisted|Promise\.race)\b/.test(text)
  ) {
    report('voice-synthesis-flow-is-shared', fileName, source, source, 'adapter:synthesis-policy')
  }

  if (/useWhisperStore\.getState\(\)\.(?:downloadModel|selectModel|loadModel|unloadModel|deleteModel|deleteModelById|refreshPresentModels)/.test(text)) {
    report('transcription-workflow-is-shared', fileName, source, source, 'call:whisper-store-workflow')
  }

  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      if (isUi && /(services\/litert(?:\.|$)|llama|whisperService|localDreamGenerator|imageGenerationService|adapters\/providers)/i.test(specifier)) {
        report('ui-does-not-import-raw-model-engine', fileName, source, node, `import:${specifier}`)
      }
      if (
        !isAdapter &&
        fileName !== 'src/services/modelServices/mobileLLMService.ts' &&
        /adapters\/providers$/.test(specifier)
      ) {
        report('provider-policy-uses-shared-capabilities', fileName, source, node, `import:${specifier}`)
      }
      if (
        /modelServices\/modelLifecycleBootstrap/.test(specifier) &&
        !/^src\/services\/(modelServices|adapters)\//.test(fileName) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text
          if (/^(?:load|unload|eject|force)\w*Models?$/.test(importedName)) {
            report('deprecated-residency-api-outside-model-port', fileName, source, element, `import:${importedName}`)
          }
        }
      }
      if (
        fileName === 'src/services/imageGenerationService.ts' &&
        /(remoteServerStore|localDreamGenerator|imagePromptEnhancement|residencyIntents|sharedImageGeneration)/.test(specifier)
      ) {
        report('mobile-image-lifecycle-is-shared', fileName, source, node, `import:${specifier}`)
      }
      if (
        fileName !== 'src/services/modelServices/toolPorts.ts' &&
        /(?:litertToolSelector|toolEmbeddingRouter|toolCapabilityPreflight|llmToolGeneration)/.test(specifier)
      ) {
        report('mobile-tool-routing-is-shared', fileName, source, node, `import:${specifier}`)
      }
      if (
        fileName !== 'src/services/modelServices/imageGenerationApplication.ts' &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text
          if (/^(?:imageRuntimeNeedsReload|isFirstImageRuntimeRun|imageApplicationFailure|imageProgressStatus|resolveImageGenerationSettings)$/.test(importedName)) {
            report('mobile-image-lifecycle-is-shared', fileName, source, element, `import:${importedName}`)
          }
        }
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /modelServices\/modelLifecycleBootstrap/.test(node.moduleSpecifier.text) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        if (/^(?:load|unload|eject|force)\w*Models?$/.test(element.name.text)) {
          report('deprecated-residency-api-outside-model-port', fileName, source, element, `export:${element.name.text}`)
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const call = nodeText(source, node.expression)
      const rawName = call.split('.').at(-1)
      if (
        /^(setActiveModelId|setActiveImageModelId|setActiveServerId|setActiveRemoteTextModelId|setActiveRemoteImageModelId|setActiveRemoteMediaServerId)$/.test(rawName) &&
        fileName !== 'src/services/modelServices/modelSelectionProjection.ts'
      ) {
        report('active-model-writes-use-canonical-selection-port', fileName, source, node, `call:${rawName}`)
      }
      if (fileName !== 'src/services/modelServices/modelSelectionProjection.ts') {
        const assignedKeys = node.arguments.flatMap(assignedSelectionKeys)
        if (
          /\.setState$/.test(call) &&
          assignedKeys.length > 0
        ) {
          report('selection-projections-have-one-writer', fileName, source, node, `call:${call}:${assignedKeys.join(',')}`)
        }
        if (/\.updateSettings$/.test(call) && assignedKeys.includes('classifierModelId')) {
          report('selection-projections-have-one-writer', fileName, source, node, `call:${call}`)
        }
      }
      if (/^(generateResponse|generateResponseWithTools|generateWithMaxTokens|generateToolSelection|generateForChatSession|completeText|completeTextWithTools|completeCappedText|dispatchGenerationFn|resolveTurnKind|regenerateResponseFn)$/.test(rawName)) {
        report('generation-callers-use-shared-service', fileName, source, node, `call:${rawName}`)
      }
      if (/^(chat|chatMessages|chatStream|streamChat)$/.test(rawName)) {
        report('no-route-owning-llm-api', fileName, source, node, `call:${rawName}`)
      }
      if (
        /^useDownloadStore\.getState\(\)\.(add|setStatus|setProcessing|retryEntry|remove)$/.test(call) &&
        !/^src\/services\/(adapters\/downloads\/|adapters\/models\/library\/|downloadEventProjection\.ts$)/.test(fileName)
      ) {
        report('apps-do-not-own-download-state-machines', fileName, source, node, `call:${call}`)
      }
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(generateResponse|generateResponseWithTools|generateWithMaxTokens|generateToolSelection|generateForChatSession|completeText|completeTextWithTools|completeCappedText|chat|chatMessages|chatStream|streamChat)$/.test(node.name.getText(source)) &&
      /^(src\/services\/(llm|litert)\.ts)$/.test(fileName)
    ) {
      report('no-route-owning-llm-api', fileName, source, node.name, `declaration:${node.name.getText(source)}`)
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(?:ensureImageModelLoaded|runGenerationAndSave|enhanceImageGenerationPrompt|resolveImageGenerationRoute|retryImageGeneration|forceLoadImageModel)$/.test(node.name.getText(source))
    ) {
      report('mobile-image-lifecycle-is-shared', fileName, source, node.name, `declaration:${node.name.getText(source)}`)
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(?:generateWithToolsImpl|selectRelevantTools|selectToolsByEmbedding|remoteToolCapabilityIssue)$/.test(node.name.getText(source))
    ) {
      report('mobile-tool-routing-is-shared', fileName, source, node.name, `declaration:${node.name.getText(source)}`)
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(?:computeFilteredResults|bestFitScore|matchesOrgFilter|isTextModel|defaultModelIds|fetchGatewayModelCatalogPolicy)$/.test(node.name.getText(source))
    ) {
      report('mobile-catalog-policy-is-shared', fileName, source, node.name, `declaration:${node.name.getText(source)}`)
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^(?:cancelRequested|remoteImageRequest|lastImageGenerationParams)$/.test(node.name.text)
    ) {
      report('mobile-image-lifecycle-is-shared', fileName, source, node.name, `declaration:${node.name.text}`)
    }

    if (
      (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.name && /^(ProviderRegistry|LLMProvider)$/.test(node.name.text)
    ) {
      report('no-parallel-provider-control-plane', fileName, source, node.name, `declaration:${node.name.text}`)
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^(providerRegistry|localProvider)$/.test(node.name.text)) {
      report('no-parallel-provider-control-plane', fileName, source, node.name, `declaration:${node.name.text}`)
    }

    if (isAdapter && (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node))) {
      const condition = ts.isIfStatement(node)
        ? node.expression
        : ts.isSwitchStatement(node)
          ? node.expression
          : node.condition
      const expression = nodeText(source, condition)
      if (
        /(provider(Id)?\s*(===|!==)|\.provider(Id)?\s*(===|!==)|instanceof\s+\w*Provider|is(?:Ollama|OpenRouter|Gemini)|enableThinking|disableThinking|reasoningControl)/i.test(expression)
      ) {
        report('adapters-do-not-own-provider-or-reasoning-policy', fileName, source, condition, `branch:${expression}`)
      }
    }

    if (isUi && ts.isStringLiteralLike(node) && node.text.includes('remote-vision:')) {
      report('internal-remote-vision-id-never-reaches-ui', fileName, source, node, `literal:${node.text}`)
    }

    if (
      /^src\/screens\/ChatScreen\/(mobileChatSession|useChatGenerationActions)\.tsx?$/.test(fileName) &&
      ts.isImportSpecifier(node) &&
      /^(generationService|imageGenerationService|onnxImageGeneratorService)$/.test(node.name.text)
    ) {
      report('ui-uses-chat-projection-and-model-ports', fileName, source, node, `import:${node.name.text}`)
    }

    if (ts.isClassDeclaration(node) && node.name && /(DownloadQueue|DownloadCoordinator|DownloadStateMachine|DownloadRegistry|WhisperModelDownloads)$/.test(node.name.text)) {
      report('apps-do-not-own-download-state-machines', fileName, source, node.name, `class:${node.name.text}`)
    }

    if (
      (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) &&
      /^(whisperModel|ttsModel|activeWhisperModel|activeTtsModel|whisper_model|tts_model)$/.test(
        node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : '',
      )
    ) {
      report('no-legacy-whisper-or-tts-setting-key', fileName, source, node.name, `key:${node.name.text}`)
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
}

const allowlist = new Map(temporaryModelArchitectureAllowlist.map(entry => [entry.key, entry]))
const used = new Set()
const violations = []
for (const finding of findings) {
  const key = keyOf(finding)
  if (allowlist.has(key)) used.add(key)
  else violations.push(finding)
}
const stale = [...allowlist.values()].filter(entry => !used.has(entry.key))

for (const finding of findings.filter(finding => allowlist.has(keyOf(finding)))) {
  const debt = allowlist.get(keyOf(finding))
  console.warn(`TEMPORARY ${finding.rule}: ${finding.file}:${finding.line} ${finding.detail}`)
  console.warn(`  owner=${debt.owner}; reason=${debt.reason}; removeWhen=${debt.removeWhen}`)
}
if (violations.length > 0 || stale.length > 0) {
  for (const finding of violations) {
    console.error(`VIOLATION ${finding.rule}: ${finding.file}:${finding.line} ${finding.detail}`)
  }
  for (const entry of stale) console.error(`STALE ALLOWLIST: ${entry.key}`)
  process.exitCode = 1
} else {
  console.log(`Mobile model architecture gate passed (${used.size} temporary item(s)).`)
}
