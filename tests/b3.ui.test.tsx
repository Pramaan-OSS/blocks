// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedPanel, PersonPosts } from "@/components/pramaan/feed/feed-panel";
import { MessagingPanel } from "@/components/pramaan/messaging/messaging-panel";
import { resetCrmFake } from "@/lib/pramaan/crm-data";
import { feedAction, homeFeed } from "@/lib/pramaan/feed";
import { messagingAction, thread } from "@/lib/pramaan/messaging";
import { isBlocked } from "@/lib/pramaan/moderation";
import { saveProfile } from "@/lib/pramaan/profiles";
import * as feed from "@/registry/feed/app/api/pramaan/feed/route";
import * as messages from "@/registry/messaging/app/api/pramaan/messages/route";

let member = "mbr_owner";
const scope = "demo";
const INTERNAL = /mbr_|file_|[0-9a-f]{8}-[0-9a-f]{4}-/;
beforeEach(() => {
  resetCrmFake(); member = "mbr_owner"; window.history.replaceState(null, "", "/");
  vi.stubEnv("PRAMAAN_SOCIAL_SCOPE", "demo"); vi.stubEnv("PRAMAAN_TEXT_SCREENING", "");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const request = new Request(`http://app.test${url}`, { ...init, headers: { ...(init.headers as object), cookie: `pramaan_member=${member}` } });
    const route = url.includes("/messages") ? messages : feed;
    return request.method === "GET" ? route.GET(request) : route.POST(request);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const sample = async () => {
  await saveProfile(scope, "mbr_sample", { revision: 0, name: "Sam Rivera", bio: "", links: [], public: { name: true, bio: false, links: false, photo: false } });
  await feedAction(scope, member, { action: "follow", person: "mbr_sample" });
  return feedAction(scope, "mbr_sample", { action: "post", text: "Hello from Sam" });
};
const conversation = async (text?: string) => {
  const { id } = await messagingAction(scope, "mbr_sample", { action: "start", person: member }) as { id: string };
  if (text) await messagingAction(scope, "mbr_sample", { action: "send", id, text });
  return id;
};
it("posts from the feed and shows the post first, with no internal references", async () => {
  await sample();
  const user = userEvent.setup(); render(<FeedPanel />);
  await user.type(await screen.findByLabelText("Share something"), "My first post");
  await user.click(screen.getByRole("button", { name: "Post" }));
  await screen.findByText("Posted.");
  expect(screen.getAllByRole("article").map(a => a.getAttribute("aria-label"))).toEqual(["Post by You", "Post by Sam Rivera"]);
  expect(document.body.textContent).not.toMatch(INTERNAL);
});
it("likes and comments on a post", async () => {
  await sample();
  const user = userEvent.setup(); render(<FeedPanel />);
  const card = await screen.findByRole("article", { name: "Post by Sam Rivera" });
  await user.click(within(card).getByRole("button", { name: "Like · 0" }));
  await within(card).findByRole("button", { name: "Liked · 1" });
  await user.click(within(card).getByRole("button", { name: "Comments · 0" }));
  await user.type(await within(card).findByLabelText("Add a comment"), "Nice one");
  await user.click(within(card).getByRole("button", { name: "Comment" }));
  await within(card).findByText("Nice one");
  await within(card).findByRole("button", { name: "Comments · 1" });
});
it("edits and deletes your own post after confirming, and offers report and block only on other people's", async () => {
  await feedAction(scope, member, { action: "post", text: "Draft thought" }); await sample();
  const user = userEvent.setup(); render(<FeedPanel />);
  const mine = await screen.findByRole("article", { name: "Post by You" });
  expect(within(mine).queryByText("Report post")).toBeNull();
  expect(within(mine).queryByRole("button", { name: "Block person" })).toBeNull();
  await user.click(within(mine).getByRole("button", { name: "Edit post" }));
  const box = within(mine).getByLabelText("Edit post");
  await user.clear(box); await user.type(box, "Better thought");
  await user.click(within(mine).getByRole("button", { name: "Save post" }));
  await within(mine).findByText("Better thought"); within(mine).getByText(/Edited/);
  await user.click(within(mine).getByRole("button", { name: "Delete post" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete post" }));
  await waitFor(() => expect(screen.queryByRole("article", { name: "Post by You" })).toBeNull());
  expect((await homeFeed(scope, member)).posts).toHaveLength(1);
});
it("removes a blocked person's posts from the screen and keeps the block", async () => {
  await sample();
  const user = userEvent.setup(); render(<FeedPanel />);
  const card = await screen.findByRole("article", { name: "Post by Sam Rivera" });
  await user.click(within(card).getByRole("button", { name: "Block person" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Block person" }));
  await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  expect(await isBlocked(member, "mbr_sample", scope)).toBe(true);
});
it("sends a report with a reason", async () => {
  await sample();
  const user = userEvent.setup(); render(<FeedPanel />);
  const card = await screen.findByRole("article", { name: "Post by Sam Rivera" });
  await user.click(within(card).getByText("Report post"));
  await user.type(within(card).getByLabelText("Why are you reporting this?"), "Spam");
  await user.click(within(card).getByRole("button", { name: "Send report" }));
  await within(card).findByText("Report sent.");
});
it("says so when more posts can't load, and keeps the ones already shown", async () => {
  await sample();
  for (let i = 0; i < 20; i++) await feedAction(scope, member, { action: "post", text: `Note ${i}` });
  const user = userEvent.setup(); render(<FeedPanel />);
  const more = await screen.findByRole("button", { name: "Show more" });
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
  await user.click(more);
  await screen.findByText(/Can't reach the server/);
  expect(screen.getAllByRole("article")).toHaveLength(20);
});
it("follows and unfollows from a person's page and hides those on your own", async () => {
  await feedAction(scope, "mbr_sample", { action: "post", text: "Hello" });
  const user = userEvent.setup(); render(<PersonPosts person="mbr_sample" messagesHref="/messages" />);
  await user.click(await screen.findByRole("button", { name: "Follow" }));
  await user.click(await screen.findByRole("button", { name: "Unfollow" }));
  await screen.findByRole("button", { name: "Follow" });
  expect(screen.getByRole("link", { name: "Message" }).getAttribute("href")).toBe("/messages?with=mbr_sample");
  cleanup(); render(<PersonPosts person={member} messagesHref="/messages" />);
  await screen.findByRole("heading", { name: "Posts" });
  expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Message" })).toBeNull();
});
it("tells signed-out visitors plainly, on the feed, a person's page and messages", async () => {
  member = "none";
  render(<FeedPanel />); await screen.findByText("Your feed shows posts from the people you follow."); cleanup();
  render(<PersonPosts person="mbr_sample" />); await screen.findByText("Members can see this person's posts."); cleanup();
  render(<MessagingPanel pollMs={0} listPollMs={0} />); await screen.findByText("Your conversations are private to you.");
});
it("lists unread, opens a conversation, and marks it read", async () => {
  const id = await conversation("Are you there?");
  const user = userEvent.setup(); render(<MessagingPanel pollMs={0} listPollMs={0} />);
  await screen.findByText("1 unread");
  await user.click(screen.getByRole("button", { name: /Community member/ }));
  await screen.findByRole("region", { name: "Conversation with Community member" });
  await waitFor(() => expect(screen.queryByText("1 unread")).toBeNull());
  expect((await thread(scope, "mbr_sample", id)).messages[0].read).toBe(true);
  expect(document.body.textContent).not.toMatch(INTERNAL);
});
it("sends on Enter, adds a line on Shift+Enter, and leaves an input method's Enter alone", async () => {
  const id = await conversation("Hello");
  const user = userEvent.setup(); render(<MessagingPanel pollMs={0} listPollMs={0} />);
  await user.click(await screen.findByRole("button", { name: /Community member/ }));
  const box = await screen.findByLabelText("Your message");
  await user.type(box, "Line one{Shift>}{Enter}{/Shift}Line two");
  expect((box as HTMLTextAreaElement).value).toBe("Line one\nLine two");
  fireEvent.keyDown(box, { key: "Enter", isComposing: true });
  expect((box as HTMLTextAreaElement).value).toBe("Line one\nLine two");
  await user.keyboard("{Enter}");
  await within(screen.getByRole("log", { name: "Messages" })).findByText(/Line one\s+Line two/);
  expect((box as HTMLTextAreaElement).value).toBe("");
  expect((await thread(scope, "mbr_sample", id)).messages.at(-1)?.text).toBe("Line one\nLine two");
});
it("shows a new message without a reload", async () => {
  const id = await conversation("First");
  const user = userEvent.setup(); render(<MessagingPanel pollMs={30} listPollMs={0} />);
  await user.click(await screen.findByRole("button", { name: /Community member/ }));
  await screen.findByRole("log", { name: "Messages" });
  await messagingAction(scope, "mbr_sample", { action: "send", id, text: "Second" });
  await within(screen.getByRole("log", { name: "Messages" })).findByText("Second");
});
it("opens a conversation from ?with= and says plainly when it can't", async () => {
  await saveProfile(scope, "mbr_sample", { revision: 0, name: "Sam Rivera", bio: "", links: [], public: { name: true, bio: false, links: false, photo: false } });
  window.history.replaceState(null, "", "/messages?with=mbr_sample");
  render(<MessagingPanel pollMs={0} listPollMs={0} />);
  await screen.findByRole("region", { name: "Conversation with Sam Rivera" }); cleanup();
  await feedAction(scope, member, { action: "block", person: "mbr_sample" });
  render(<MessagingPanel pollMs={0} listPollMs={0} />);
  await screen.findByText("This person can't be messaged.");
});
it("closes the conversation after blocking", async () => {
  await conversation("Hello");
  const user = userEvent.setup(); render(<MessagingPanel pollMs={0} listPollMs={0} />);
  await user.click(await screen.findByRole("button", { name: /Community member/ }));
  await user.click(await screen.findByRole("button", { name: "Block person" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Block person" }));
  await screen.findByText("No conversations yet");
  await screen.findByText("Choose a conversation to read it.");
});
