/**
 * Temporary architecture debt only. Each entry must name an owner, the present reason, and the
 * exact condition that removes it. The architecture gate rejects new and stale entries.
 */
const debt = (rule, file, detail, owner, reason, removeWhen) => ({
  key: `${rule}|${file}|${detail}`,
  owner,
  reason,
  removeWhen,
})

const generationCallDebt = [
  ['src/services/adapters/providers/localProvider.ts', 'call:generateResponse'],
  ['src/services/adapters/providers/localProvider.ts', 'call:generateResponseWithTools'],
  ['src/services/litertToolSelector.ts', 'call:generateToolSelection'],
  ['src/services/llm.ts', 'call:generateWithMaxTokens'],
  ['src/services/modelServices/sidecarGenerationAdapter.ts', 'call:generateResponse'],
  ['src/services/modelServices/toolPorts.ts', 'call:generateToolSelection'],
].map(([file, detail]) => debt(
  'generation-callers-use-shared-service',
  file,
  detail,
  'mobile-generation-consolidation',
  'This caller still invokes a legacy engine generation API.',
  'The caller sends a GenerationRequest through Shared GenerationService or ChatSessionService.',
))

const rawApiDebt = [
  ['src/services/litert.ts', 'declaration:generateToolSelection'],
  ['src/services/llm.ts', 'declaration:generateResponse'],
  ['src/services/llm.ts', 'declaration:generateResponseWithTools'],
  ['src/services/llm.ts', 'declaration:generateWithMaxTokens'],
  ['src/services/llm.ts', 'declaration:generateToolSelection'],
].map(([file, detail]) => debt(
  'no-route-owning-llm-api',
  file,
  detail,
  'mobile-generation-consolidation',
  'A native engine still exposes an app-level generation route.',
  'The engine implements only the Shared transport/runtime port and the route-owning method is deleted.',
))

const providerPolicyDebt = [
  ['adapters-do-not-own-provider-or-reasoning-policy', 'src/services/adapters/providers/openAICompatibleProvider.ts', 'branch:isOllamaRemoteEndpoint(this.config.endpoint)'],
  ['adapters-do-not-own-provider-or-reasoning-policy', 'src/services/adapters/remote/serverRuntime.ts', 'branch:discoveredModel && provider instanceof OpenAICompatibleProvider'],
  ['adapters-do-not-own-provider-or-reasoning-policy', 'src/services/modelServices/generationAdapters.ts', "branch:model.source === 'local' && model.providerId === 'llama'"],
  ['adapters-do-not-own-provider-or-reasoning-policy', 'src/services/modelServices/generationAdapters.ts', "branch:model.source === 'local' && model.providerId === 'litert'"],
  ['provider-policy-uses-shared-capabilities', 'src/services/toolCapabilityPreflight.ts', 'import:./adapters/providers'],
].map(([rule, file, detail]) => debt(
  rule,
  file,
  detail,
  'mobile-provider-policy',
  'Mobile still derives a provider or capability decision at an adapter boundary.',
  'Shared route/capability policy supplies the decision and the adapter only performs I/O.',
))

export const temporaryModelArchitectureAllowlist = [
  ...generationCallDebt,
  ...rawApiDebt,
  ...providerPolicyDebt,
]
