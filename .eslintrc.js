module.exports = {
  root: true,
  extends: [
    '@react-native',
    // SonarJS: Sonar-grade bug/smell detection in normal lint — free, local, and it covers
    // PRO too (pro has no cloud Sonar project; a private cloud project is paid-by-LOC). Most
    // rules stay at `error` (recommended default) as a forward guard; the handful already
    // tripped on legacy code are `warn` below with a logged burn-down (GAPS_BACKLOG).
    'plugin:sonarjs/recommended-legacy',
  ],
  plugins: [
    'react-native',
    'react',
    'react-hooks',
    'sonarjs',
  ],
  env: {
    jest: true,
    browser: true,
    node: true,
    es6: true,
  },
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',

    // Hexagonal boundary (warn ratchet, see shared/docs/MODEL_FACADE_PLAN.md): compose the model
    // layer from `@offgrid/models/workspace` (+ constants from `@offgrid/models/catalog`). Value
    // imports from the package root are the second pipeline being removed. Types stay free.
    '@typescript-eslint/no-restricted-imports': [
      'warn',
      {
        paths: [
          {
            name: '@offgrid/models',
            // Constructing a shared service in app code is app-side composition of the pipeline.
            importNames: [
              'ArtifactVerificationService',
              'CaptureReadinessApplicationService',
              'ChatContextApplicationService',
              'ChatModelReadinessService',
              'ChatOperationApplicationService',
              'ChatSessionQueue',
              'ChatSessionService',
              'ClassifierExecutionService',
              'ClassifierProvisioningService',
              'ComputerUseSessionApplicationService',
              'ConnectorDistillApplicationService',
              'ConnectorReadApplicationService',
              'ContextCompactionService',
              'DownloadedModelRegistryService',
              'DownloadOperationRegistry',
              'GenerationCancellationCoordinator',
              'GenerationIntentService',
              'GenerationRecoveryCoordinator',
              'GenerationService',
              'GenerationTurnQueue',
              'ImageArchiveImportService',
              'ImageDownloadApplicationService',
              'ImageDownloadRecoveryService',
              'ImageDownloadWorkflowService',
              'ImageGenerationApplicationService',
              'ImageGenerationJobCoordinator',
              'ImagePromptEnhancementService',
              'LLMService',
              'LoadPolicyTransitionCoordinator',
              'LocalModelImportService',
              'McpConnectorApplicationService',
              'MobileNativeLoadService',
              'MobileTextLoadAdmissionService',
              'ModelActivationService',
              'ModelCommandApplicationService',
              'ModelControlApplicationService',
              'ModelDownloadApplicationService',
              'ModelDownloadCoordinator',
              'ModelDownloadProjectionController',
              'ModelDownloadQueue',
              'ModelDownloadRegistry',
              'ModelEjectionService',
              'ModelFileImportApplicationService',
              'ModelLibraryCommandService',
              'ModelLibraryRegistryService',
              'ModelLibraryRemovalService',
              'ModelLifecycleApplicationService',
              'ModelMemoryAdvisoryService',
              'ModelMetadataRepairCommandService',
              'ModelRepairCommandService',
              'ModelResidencyManager',
              'ModelSelectionApplicationService',
              'ModelSelectionAuthority',
              'ModelTransferRegistrationService',
              'ProactiveActionApplicationService',
              'ProactiveToolCatalogService',
              'RemoteCapabilityDiscoveryApplicationService',
              'RemoteLanDiscoveryApplicationService',
              'RemoteProviderDiscoveryApplicationService',
              'RemoteServerApplicationService',
              'TextEngineApplicationService',
              'ToolRegistry',
              'ToolRoutingService',
              'VisionRepairApplicationService',
              'VoiceApplicationService',
              'VoicePlaybackService',
              'decodeModelRouteId',
              'encodeModelRouteId',
              'parseRemoteVisionModelId',
              'remoteVisionModelId',
            ],
            message:
              'Compose shared services through @offgrid/models/workspace, not in app code. Business logic lives in shared; this app is a port.',
            allowTypeImports: true,
          },
        ],
      },
    ],
    // Code quality (built-in)
    'no-empty': 'error',
    'no-else-return': 'error',
    'prefer-template': 'error',
    // Dead-branch killers (the "AI leftover" class) — untyped, cheap, high signal, zero current hits.
    'no-unreachable': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-constant-binary-expression': 'error',
    complexity: ['error', 20],
    'max-lines-per-function': ['error', 350],
    'max-lines': ['error', 500],
    'max-params': ['error', 3],
    // React hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // React Native
    'react-native/no-unused-styles': 'error',
    'react-native/no-inline-styles': 'error',
    'react-native/no-color-literals': 'error',
    'react-native/no-raw-text': 'error',
    'react-native/no-single-element-style-arrays': 'error',

    // SonarJS — every rule stays at the recommended `error` (a real forward guard on new code)
    // EXCEPT the two handled here:
    //  - no-duplicate-string OFF: it fights RN styling — 'space-between'/'center'/'row' and color
    //    literals repeat by design across StyleSheet objects; a constant per style value is noise,
    //    not clarity. The one low-value SonarJS rule for this codebase.
    //  - the rest are `warn` (already tripped on legacy core; burn-down in docs/GAPS_BACKLOG.md,
    //    ratchet each back to `error` as its count hits zero).
    'sonarjs/no-duplicate-string': 'off',
    'sonarjs/prefer-single-boolean-return': 'warn',
    'sonarjs/no-nested-template-literals': 'warn',
    'sonarjs/no-collapsible-if': 'warn',
    'sonarjs/prefer-immediate-return': 'warn',
    'sonarjs/no-duplicated-branches': 'warn',
  },
  overrides: [
    {
      // Pipeline decisions live in shared (MODEL_FACADE_PLAN.md "Defect classes"): request
      // parameters (1), route-id codecs (2), image MIME literals (3). Composition root and the
      // selection persistence ports are exempt.
      files: ['src/**/*.ts', 'src/**/*.tsx', 'pro/**/*.ts', 'pro/**/*.tsx'],
      excludedFiles: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/services/modelServices/workspace.ts',
        'src/services/composition/**',
        'pro/composition/**',
        'src/services/modelServices/mobileRoute.ts',
        'src/services/modelServices/selectionStore.ts',
        'src/services/modelServices/modelSelectionProjection.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'warn',
          {
            selector:
              "Property[key.name=/^(maxTokens|temperature|topP|timeoutMs)$/][value.type='Literal'], Property[key.name='thinking'][value.type='Literal'][value.raw=/^(true|false)$/]",
            message:
              'Class 1: a generation parameter is a pipeline decision. Use a shared request builder.',
          },
          {
            selector: "Literal[value=/^image\\/(png|jpe?g|webp)$/]",
            message: 'Class 3: image MIME types are an artifact fact owned by shared.',
          },
        ],
      },
    },
    {
      // The composition root is the ONE place shared services are constructed with this app's ports.
      files: [
        'src/services/modelServices/workspace.ts',
        'src/services/composition/**/*.ts',
        'pro/composition/**/*.ts',
        // Selection persistence ports: the ONE place mobile encodes and decodes its routes.
        'src/services/modelServices/mobileRoute.ts',
        'src/services/modelServices/selectionStore.ts',
        'src/services/modelServices/modelSelectionProjection.ts',
      ],
      rules: { '@typescript-eslint/no-restricted-imports': 'off' },
    },
    {
      files: ['scripts/physical-sync/**/*.mjs'],
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    {
      // Relax structural rules in test files — large test suites and helpers are acceptable
      files: [
        '__tests__/**/*',
        'scripts/physical-sync/__tests__/**/*.mjs',
        '*.test.ts',
        '*.test.tsx',
        'jest.setup.ts',
      ],
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-params': 'off',
        complexity: 'off',
        'react-native/no-inline-styles': 'off',
        'react-native/no-raw-text': 'off',
        'react-native/no-color-literals': 'off',
        // Duplicate test bodies (identical arrange/act across cases) are acceptable and clearer
        // than over-DRYing tests; the real-bug SonarJS rules (mischeck, unused-collection, etc.)
        // stay ON for tests — they caught a tautology assertion + a dead collection here.
        'sonarjs/no-identical-functions': 'off',
        'sonarjs/cognitive-complexity': 'off',
      },
    },
  ],
};
