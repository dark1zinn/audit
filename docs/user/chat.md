# Chat

## Channels

| Kind                 | Who can see it        | Who can create                                        |
| -------------------- | --------------------- | ----------------------------------------------------- |
| Public               | All workspace members | Owners, admins, members with `channels.create_public` |
| Private              | Members only          | Anyone except guests                                  |
| Direct message       | Two people            | Anyone                                                |
| Group direct message | Up to 8 people        | Anyone                                                |

The create dialog offers public and private channels. Direct messages are started from a person.
Channels have roles `member` and `manager`. Managers can delete messages written by others and
manage the channel.

## Messages

- Edit your own messages. Deleting leaves a tombstone: the text is removed, reactions, pins and saved
  flags are cleared, and mentions are removed.
- Up to 32 different emoji reactions per message; select an emoji again to remove yours.
- **Pin** a message to the channel. **Save** a message for yourself.
- **Convert to task** creates a task from a message. Deleted messages cannot be converted.
- Attach a file in the composer. File size follows the workspace upload limit (default 50 MB).
- You see a typing indicator while others type.

## Threads

Reply in a thread. Follow or unfollow a thread to control thread notifications. **Create doc** turns
a thread into a document.

## Notifications

Each channel has a notification level for you:

- `mentions` (default when you join): you are notified of mentions.
- `all`: every new message and reply.
- `none`: no notifications.

Mute a channel until a time to silence it temporarily. Direct messages and thread replies follow the
same level.

## Retention

Workspace admins can set a message retention period. When set, messages older than the cutoff are
purged once a day. Pinned messages are kept. The default is to keep messages forever.

## Admin access

Admins can open a private channel read-only from the admin console. The page says access is logged,
and the access is recorded in the audit trail.
