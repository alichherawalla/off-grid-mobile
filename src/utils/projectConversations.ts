import type { Conversation } from '../types';
import { byRecentActivity } from './conversationOrdering';

/** How many chats each project has, keyed by project id. */
export type ProjectChatCounts = Readonly<Record<string, number>>;

/**
 * Every project's chat count in ONE pass over the conversations.
 *
 * The projects list used to ask the question per row - `conversations.filter(c => c.projectId ===
 * id).length` inside `renderItem` - so drawing p projects over n conversations cost n x p, and every
 * chat store change re-ran all of it. One tally is O(n), read per row in O(1).
 */
export function projectChatCounts(
  conversations: readonly Conversation[],
): ProjectChatCounts {
  const counts: Record<string, number> = {};
  for (const conversation of conversations) {
    const projectId = conversation.projectId;
    if (projectId) {
      counts[projectId] = (counts[projectId] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * One project's chats, newest activity first.
 *
 * The ordering is `byRecentActivity`'s to own - the project detail and project chats screens each
 * hand-rolled a `new Date(b.updatedAt) - new Date(a.updatedAt)` sort, which is the same rule written
 * a third and fourth time.
 */
export function conversationsForProject(
  conversations: readonly Conversation[],
  projectId: string,
): Conversation[] {
  return byRecentActivity(
    conversations.filter(conversation => conversation.projectId === projectId),
  );
}
