import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { CommandError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { ChannelId, MessageId } from "../ids.ts"
import { CreatedFromMessage } from "./schema.ts"
import {
  ChannelHeader,
  ChannelSummary,
  CreateChannelInput,
  EditMessageInput,
  EmojiInput,
  MarkReadInput,
  MemberIdsInput,
  Message,
  MessagePage,
  MessagePageQuery,
  MessageToTaskInput,
  OpenDmInput,
  PostMessageInput,
  SetNotifyInput,
  ThreadSummary,
  ThreadToDocInput,
  ThreadView,
  UpdateChannelInput,
} from "./schema.ts"

const channelParams = { params: { channelId: ChannelId } }
const messageParams = { params: { messageId: MessageId } }

/** Channels, DMs, messages, reactions, pins, threads and saved messages. */
export const ChatApi = HttpApiGroup.make("chat")
  .add(
    HttpApiEndpoint.get("channels", "/api/chat/channels", {
      success: Schema.Array(ChannelSummary),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("browse", "/api/chat/channels/browse", {
      success: Schema.Array(ChannelSummary),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createChannel", "/api/chat/channels", {
      payload: CreateChannelInput,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("channel", "/api/chat/channels/:channelId", {
      ...channelParams,
      success: ChannelHeader,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateChannel", "/api/chat/channels/:channelId", {
      ...channelParams,
      payload: UpdateChannelInput,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("archiveChannel", "/api/chat/channels/:channelId/archive", {
      ...channelParams,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unarchiveChannel", "/api/chat/channels/:channelId/unarchive", {
      ...channelParams,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("joinChannel", "/api/chat/channels/:channelId/join", {
      ...channelParams,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("leaveChannel", "/api/chat/channels/:channelId/leave", {
      ...channelParams,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("addMembers", "/api/chat/channels/:channelId/members", {
      ...channelParams,
      payload: MemberIdsInput,
      success: ChannelHeader,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("removeMember", "/api/chat/channels/:channelId/members/remove", {
      ...channelParams,
      payload: MemberIdsInput,
      success: ChannelHeader,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("setNotify", "/api/chat/channels/:channelId/notify", {
      ...channelParams,
      payload: SetNotifyInput,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("markRead", "/api/chat/channels/:channelId/read", {
      ...channelParams,
      payload: MarkReadInput,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("openDm", "/api/chat/dms", {
      payload: OpenDmInput,
      success: ChannelSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("messages", "/api/chat/channels/:channelId/messages", {
      ...channelParams,
      query: MessagePageQuery,
      success: MessagePage,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("postMessage", "/api/chat/channels/:channelId/messages", {
      ...channelParams,
      payload: PostMessageInput,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("editMessage", "/api/chat/messages/:messageId", {
      ...messageParams,
      payload: EditMessageInput,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteMessage", "/api/chat/messages/:messageId/delete", {
      ...messageParams,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("addReaction", "/api/chat/messages/:messageId/reactions", {
      ...messageParams,
      payload: EmojiInput,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("removeReaction", "/api/chat/messages/:messageId/reactions/remove", {
      ...messageParams,
      payload: EmojiInput,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("pins", "/api/chat/channels/:channelId/pins", {
      ...channelParams,
      success: Schema.Array(Message),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("pin", "/api/chat/messages/:messageId/pin", {
      ...messageParams,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unpin", "/api/chat/messages/:messageId/unpin", {
      ...messageParams,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("save", "/api/chat/messages/:messageId/save", {
      ...messageParams,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unsave", "/api/chat/messages/:messageId/unsave", {
      ...messageParams,
      success: Message,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("messageToTask", "/api/chat/messages/:messageId/task", {
      ...messageParams,
      payload: MessageToTaskInput,
      success: CreatedFromMessage,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("saved", "/api/chat/saved", {
      success: Schema.Array(Message),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("thread", "/api/chat/messages/:messageId/thread", {
      ...messageParams,
      query: MessagePageQuery,
      success: ThreadView,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("threads", "/api/chat/threads", {
      success: Schema.Array(ThreadSummary),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("followThread", "/api/chat/messages/:messageId/thread/follow", {
      ...messageParams,
      success: ThreadView,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unfollowThread", "/api/chat/messages/:messageId/thread/unfollow", {
      ...messageParams,
      success: ThreadView,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("threadMarkRead", "/api/chat/messages/:messageId/thread/read", {
      ...messageParams,
      success: ThreadView,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("threadToDoc", "/api/chat/messages/:messageId/thread/doc", {
      ...messageParams,
      payload: ThreadToDocInput,
      success: CreatedFromMessage,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("adminChannel", "/api/chat/admin/channels/:channelId", {
      ...channelParams,
      success: ChannelHeader,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("adminMessages", "/api/chat/admin/channels/:channelId/messages", {
      ...channelParams,
      query: MessagePageQuery,
      success: MessagePage,
      error: CommandError,
    }),
  )
  .middleware(Authentication)
