// Tabs an agent opens go into a tab group named after it (one per agent per window), so the user
// always sees what an agent is working on and can close it in one click.

import { getSession, setSession } from './store.js';

export async function addToAgentGroup(agent, tabId) {
  const tab = await chrome.tabs.get(tabId);
  const groups = await getSession('agentGroups', {});
  const key = `${agent.id}|${tab.windowId}`;
  const existing = groups[key];

  if (existing !== undefined) {
    try {
      await chrome.tabGroups.get(existing);
      await chrome.tabs.group({ tabIds: [tabId], groupId: existing });
      return existing;
    } catch {
      // The user closed or ungrouped it; start a fresh group below.
    }
  }

  const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(groupId, { title: agent.label, color: agent.color ?? 'blue', collapsed: false });
  groups[key] = groupId;
  await setSession('agentGroups', groups);
  return groupId;
}
