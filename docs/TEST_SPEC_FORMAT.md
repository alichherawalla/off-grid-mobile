# Test Specification Format

This document defines the standard format for test specifications in LocalLLM. When implementing a feature, create a test spec following this format.

**Current Test Infrastructure:**
- ✅ Jest (unit, integration, RNTL, contract tests)
- ✅ Maestro (E2E tests on real device)
- ✅ Factories and test helpers (`__tests__/utils/`)
- ✅ 237 existing tests (see `TEST_PRIORITY_MAP.md` for breakdown)

**See existing tests for examples:**
- Unit: `__tests__/unit/stores/chatStore.test.ts` (comprehensive example)
- Integration: `__tests__/integration/models/activeModelService.test.ts`
- RNTL: `__tests__/rntl/screens/ChatScreen.test.tsx`
- E2E: `.maestro/flows/p0/02-text-generation.yaml`
- Contract: `__tests__/contracts/llamaContext.contract.test.ts`

---

## Spec Structure

```yaml
flow:
  id: "<category>.<number>"           # e.g., "generation.1"
  name: "<descriptive name>"
  priority: P0 | P1 | P2              # P0 = critical, P1 = important, P2 = nice-to-have

  description: |
    What this flow does and why it matters.

  preconditions:
    - List of things that must be true before this flow
    - e.g., "Model is downloaded", "User is authenticated"

  triggers:
    - User actions or events that start this flow
    - e.g., "User taps send button", "App receives push notification"

  expected_outcomes:
    - What should happen when the flow completes successfully
    - Be specific and measurable

  error_cases:
    - id: "<flow_id>.error.<n>"
      condition: "What causes the error"
      expected: "How the app should handle it"

  testing:
    unit:
      applicable: true | false
      targets:
        - file: "src/path/to/file.ts"
          function: "functionName"
          test_cases:
            - input: "description of input"
              expected: "expected output"

    integration:
      applicable: true | false
      targets:
        - description: "What integration to test"
          components: ["ComponentA", "ServiceB"]
          test_cases:
            - scenario: "description"
              expected: "outcome"

    rntl:
      applicable: true | false
      targets:
        - screen: "ScreenName"
          test_cases:
            - action: "user action"
              expected: "UI outcome"

    e2e:
      applicable: true | false
      targets:
        - flow: "description of full flow"
          steps:
            - action: "step 1"
            - action: "step 2"
          expected: "final outcome"

    contract:
      applicable: true | false
      targets:
        - module: "NativeModuleName"
          method: "methodName"
          expected: "return type or behavior"
```

---

## Priority Definitions

| Priority | Definition | Test Coverage Required |
|----------|------------|----------------------|
| **P0** | App is broken without this. Core functionality. | All layers (unit + RNTL + E2E) |
| **P1** | Important feature, users would notice if broken. | Unit + RNTL minimum |
| **P2** | Nice to have, edge cases, polish. | Unit tests minimum |

---

## Testing Layer Definitions

### Unit Tests
**What:** Pure functions, state mutations, business logic
**Tools:** Jest
**Speed:** <10ms per test
**When to use:**
- Store actions/mutations
- Service methods that don't touch native modules
- Utility functions
- Intent classification patterns
- Data transformations

### Integration Tests
**What:** Multiple services/stores working together
**Tools:** Jest + partial mocking
**Speed:** <100ms per test
**When to use:**
- Service A calls Service B
- Store changes trigger service calls
- Complex state orchestration

### RNTL Tests (React Native Testing Library)
**What:** Screen/component behavior from user perspective
**Tools:** @testing-library/react-native
**Speed:** <500ms per test
**When to use:**
- Screen renders correct state
- User interactions update UI
- Component responds to store changes
- Form validation
- Navigation triggers

### E2E Tests
**What:** Full user flows on real device
**Tools:** Maestro or Detox
**Speed:** 10s-60s per test
**When to use:**
- Critical user journeys
- Flows that touch native modules
- Real model loading/generation
- Flows spanning multiple screens

### Contract Tests
**What:** Native module interface verification
**Tools:** Jest + real native calls
**Speed:** <1s per test
**When to use:**
- Verify native module exists
- Verify method signatures
- Verify basic call/response works

---

## Example Spec

```yaml
flow:
  id: "generation.text.1"
  name: "Basic Text Generation"
  priority: P0

  description: |
    User sends a text message and receives a streaming response from the LLM.
    This is the core functionality of the app.

  preconditions:
    - Text model is downloaded
    - Text model is loaded into memory
    - User is in an active conversation

  triggers:
    - User types message and taps send button

  expected_outcomes:
    - User message appears in chat immediately
    - Assistant response streams token by token
    - Response completes and is saved
    - Generation metadata is recorded (tok/s, time, etc.)

  error_cases:
    - id: "generation.text.1.error.1"
      condition: "Model crashes during generation"
      expected: "Error message shown, partial response preserved if any"
    - id: "generation.text.1.error.2"
      condition: "User stops generation"
      expected: "Generation halts, partial response saved"

  testing:
    unit:
      applicable: true
      targets:
        - file: "src/stores/chatStore.ts"
          function: "addMessage"
          test_cases:
            - input: "message object"
              expected: "message added to conversation"
        - file: "src/stores/chatStore.ts"
          function: "appendToStreamingMessage"
          test_cases:
            - input: "token string"
              expected: "token appended to streaming content"
        - file: "src/stores/chatStore.ts"
          function: "finalizeStreamingMessage"
          test_cases:
            - input: "none"
              expected: "streaming message becomes permanent message"
        - file: "src/services/generationService.ts"
          function: "state transitions"
          test_cases:
            - input: "idle → startGeneration"
              expected: "state becomes 'generating'"
            - input: "generating → stopGeneration"
              expected: "state becomes 'idle'"

    integration:
      applicable: true
      targets:
        - description: "generationService updates chatStore"
          components: ["generationService", "chatStore"]
          test_cases:
            - scenario: "generation produces tokens"
              expected: "chatStore.streamingMessage updates"
            - scenario: "generation completes"
              expected: "chatStore has new assistant message"

    rntl:
      applicable: true
      targets:
        - screen: "ChatScreen"
          test_cases:
            - action: "render with no messages"
              expected: "empty state shown"
            - action: "render with streaming message"
              expected: "streaming content visible"
            - action: "tap send with text"
              expected: "generationService.generateResponse called"
            - action: "tap stop during generation"
              expected: "generationService.stopGeneration called"

    e2e:
      applicable: true
      targets:
        - flow: "Full text generation"
          steps:
            - action: "Launch app with model loaded"
            - action: "Navigate to chat"
            - action: "Type 'Hello'"
            - action: "Tap send"
            - action: "Wait for response"
          expected: "Assistant message appears with content"

    contract:
      applicable: true
      targets:
        - module: "llama.rn"
          method: "completion"
          expected: "returns async iterator of tokens"
```

---

## Mapping Flow to Spec

When implementing a feature, follow these steps:

1. **Identify the flow** from TEST_FLOWS.md
2. **Determine priority** based on how critical it is
3. **List preconditions** - what must be true before
4. **Define triggers** - what starts the flow
5. **Specify outcomes** - what should happen
6. **Enumerate errors** - what can go wrong
7. **Map to test layers** - which layers apply and what to test at each

---

## File Naming Convention

```
__tests__/
  specs/
    generation.text.1.spec.yaml      # The spec file
  unit/
    generation/
      textGeneration.test.ts         # Unit tests for this flow
  integration/
    generation/
      textGeneration.test.ts         # Integration tests
  rntl/
    screens/
      ChatScreen.test.tsx            # RNTL tests (grouped by screen)
  e2e/
    flows/
      textGeneration.test.ts         # E2E tests
```
