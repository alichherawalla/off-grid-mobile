# Claude Test Spec Generation Skill

Use this prompt as a skill for Claude to generate test specs when implementing features.

---

## Skill Prompt

```
You are implementing features for OffgridMobile, a React Native app for on-device LLM and image generation.

When you implement or modify a feature, you MUST also create a test specification and tests.

## Reference Documents

Read these files to understand the testing strategy:
- docs/TEST_FLOWS.md - Comprehensive list of all testable flows
- docs/TEST_SPEC_FORMAT.md - The YAML spec format to follow
- docs/TEST_PRIORITY_MAP.md - Priority and testing layer mapping

## Your Responsibilities

When implementing a feature:

1. **Identify affected flows** from TEST_FLOWS.md
2. **Check priority** in TEST_PRIORITY_MAP.md
3. **Generate test spec** following TEST_SPEC_FORMAT.md
4. **Write the actual tests** at appropriate layers

## Test Spec Location

Save specs to: `__tests__/specs/<category>.<flow_id>.spec.yaml`

## Test File Locations

- Unit tests: `__tests__/unit/<category>/<name>.test.ts`
- Integration: `__tests__/integration/<category>/<name>.test.ts`
- RNTL: `__tests__/rntl/screens/<ScreenName>.test.tsx`
- E2E: `e2e/flows/<name>.test.ts`

## What to Test at Each Layer

### Unit Tests
- Store mutations (appStore, chatStore, etc.)
- Pure service functions
- Utility functions
- Intent classifier patterns
- State machine transitions

Example:
```typescript
// __tests__/unit/stores/chatStore.test.ts
describe('chatStore', () => {
  describe('addMessage', () => {
    it('adds message to conversation', () => {
      // ...
    });
  });
});
```

### Integration Tests
- Service-to-service communication
- Service-to-store updates
- Complex async flows (without native modules)

Example:
```typescript
// __tests__/integration/generation/generationFlow.test.ts
describe('Generation Flow', () => {
  it('updates chatStore when tokens arrive', async () => {
    // ...
  });
});
```

### RNTL Tests
- Screen renders correct state
- User interactions trigger correct actions
- Component responds to store changes
- UI disabled states

Example:
```tsx
// __tests__/rntl/screens/ChatScreen.test.tsx
describe('ChatScreen', () => {
  it('disables send when generating', () => {
    useChatStore.setState({ isStreaming: true });
    const { getByTestId } = render(<ChatScreen />);
    expect(getByTestId('send-button')).toBeDisabled();
  });
});
```

### E2E Tests
- Full user flows on device
- Flows touching native modules
- Critical paths only (P0)

Example:
```yaml
# e2e/flows/textGeneration.yaml (Maestro)
appId: ai.offgridmobile
---
- launchApp
- tapOn: "chat-input"
- inputText: "Hello"
- tapOn: "send-button"
- assertVisible:
    id: "assistant-message"
    timeout: 60000
```

### Contract Tests
- Native module exists
- Methods are callable
- Basic call/response works

Example:
```typescript
// __tests__/contracts/nativeModules.test.ts
describe('LocalDream Contract', () => {
  it('module exists on Android', () => {
    expect(NativeModules.LocalDream).toBeDefined();
  });

  it('isModelLoaded returns boolean', async () => {
    const result = await NativeModules.LocalDream.isModelLoaded();
    expect(typeof result).toBe('boolean');
  });
});
```

## Test Utilities Available

```typescript
import {
  createTestMessage,
  createTestConversation,
  createTestModel,
  resetStores,
  waitForState,
} from '__tests__/utils/testHelpers';
```

## Priority Rules

- **P0 flows**: Must have unit + RNTL + E2E tests
- **P1 flows**: Must have unit + RNTL tests
- **P2 flows**: Must have unit tests minimum

## Example Output

When asked to implement "add message editing", produce:

1. **Spec file**: `__tests__/specs/generation.edit.spec.yaml`
2. **Unit test**: `__tests__/unit/stores/chatStore.edit.test.ts`
3. **RNTL test**: Add cases to `__tests__/rntl/screens/ChatScreen.test.tsx`
4. **Feature code**: The actual implementation

## Anti-Patterns to Avoid

❌ Mocking everything (test real behavior where possible)
❌ Testing implementation details (test behavior)
❌ Skipping tests for "simple" changes
❌ Writing E2E tests for edge cases (use unit tests)
❌ Not checking priority before deciding test coverage
```

---

## Usage

Add this to your Claude Code configuration as a skill, or include in your system prompt when working on OffgridMobile.

When you say "implement X", Claude will:
1. Identify the flow
2. Generate the spec
3. Write tests at appropriate layers
4. Implement the feature
