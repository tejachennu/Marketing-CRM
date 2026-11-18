# Meta App Review: Instagram for WAMA CRM

Everything to paste into Meta's App Review form for the **Magnetora AI** app (Instagram API with Unified Login).
Until it passes, only people with a role on the app (and their own Instagram accounts) can use Instagram in WAMA, and
Meta does not send comment webhooks.

## 1. Before you submit (Meta App Dashboard)

- [ ] **Instagram configuration** (Facebook Login for Business → Configurations → the Instagram one): keep only
      `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`.
      **Remove `ads_management` and `ads_read`** (Meta's default adds them; WAMA does not use them, and unused
      permissions are a common reason to be refused).
- [ ] **Business verification** done for the business portfolio that owns the app.
- [ ] **App settings → Basic**: app icon (1024×1024), category *Business and pages*, contact email, and:
  - Privacy Policy URL: `https://wamacrm.magnetora.in/privacy`
  - Terms of Service URL: `https://wamacrm.magnetora.in/terms`
  - User data deletion: **Data deletion instructions URL** `https://wamacrm.magnetora.in/data-deletion`
- [ ] **Webhooks** (Instagram → API setup with Facebook login → Configure webhooks): callback
      `https://wamacrm.magnetora.in/api/webhooks/instagram`, verify token = `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` in Vercel,
      fields `messages`, `messaging_postbacks`, `messaging_seen`, `comments` subscribed.
- [ ] **A test login for the reviewer**: a WAMA CRM user (password only; the emailed code is off) in a workspace
      where Instagram is connected. Put the email and password **only in Meta's form**, never in the repo or chat.
- [ ] **Screencast** recorded (section 4). One video can cover every permission; give the time for each.

## 2. Request

Permissions and features to request **Advanced Access** for:

| Permission / feature | Why WAMA needs it |
|---|---|
| `instagram_basic` | Read the connected account's ID, username, picture and media list (needed by every other call) |
| `instagram_manage_messages` | Receive and answer Instagram DMs in the business's WAMA inbox |
| `instagram_manage_comments` | Show comments on the business's posts and reels; reply, reply privately, hide, delete |
| `instagram_content_publish` | Post photos and carousels to the business's own account from WAMA |
| **Human Agent** feature | Let a person on the business's team answer up to 7 days after the customer wrote |

## 3. Text for each permission

### instagram_basic

**How will your app use this permission?**
WAMA CRM is a customer inbox for small businesses. A business owner connects their own Instagram professional
account with Facebook Login for Business. We use instagram_basic to read that account's ID, username, name and
profile picture, so we can show which account is connected in Settings → Instagram, link incoming messages and
comments to it, and list the account's latest posts (picture, caption, link) on the business's own online store page
and in WAMA's Instagram → Posts tab. We only read the account the business connected, and nothing is shared with
other businesses.

**Steps for the reviewer**
1. Sign in at https://wamacrm.magnetora.in/login with the test login.
2. Open Settings → Instagram: the connected account's username and picture show.
3. Open Instagram → Posts: the account's latest posts show as a grid.

### instagram_manage_messages

**How will your app use this permission?**
Businesses answer their customers' Instagram direct messages from one team inbox in WAMA CRM, next to (but separate
from) WhatsApp. When a customer sends a DM to the business, it appears in Instagram → Chats, and anyone on the
business's team can reply with text, photos, videos, voice notes or PDF files. If the business switches it on, an
assistant answers common questions from the business's own knowledge base within 24 hours, and hands the chat to a
person when it cannot answer. We only send messages in reply to people who wrote to the business first, inside
Instagram's messaging window. Messages are never used for advertising.

**Steps for the reviewer**
1. Sign in with the test login and open Instagram → Chats.
2. From any Instagram account, send a DM to @<connected username>. It appears in the list within a minute.
3. Open the chat, type a reply and press Enter. The reply arrives in Instagram.
4. Attach a photo or PDF with the paperclip and send it. It arrives in Instagram.

### instagram_manage_comments

**How will your app use this permission?**
Businesses see the comments on their own posts and reels in WAMA CRM (Instagram → Comments), grouped by post, and
answer them: reply in public, reply once privately by DM (Instagram's private reply), hide spam or abusive comments,
or delete them. Businesses can also set automatic replies for comments that contain words they choose (for example
"price"), so customers get an answer quickly. We only read and act on comments on the connected business's own media.

**Steps for the reviewer**
1. From any Instagram account, comment on a post of @<connected username>.
2. In WAMA, open Instagram → Comments and press "Check now". The comment shows under its post.
3. Click Reply, type an answer, press Post. The reply appears on Instagram.
4. Click Hide on a comment. It is hidden on Instagram. Click Show to bring it back.

### instagram_content_publish

**How will your app use this permission?**
Businesses post product photos to their own Instagram account from WAMA CRM without switching apps: Instagram →
Posts → New post (one photo or a carousel, with a caption), or from a product in their catalogue ("Post on
Instagram", which fills in the product's photo, price and order link). We publish only when the business presses
"Post on Instagram", and only to the account it connected.

**Steps for the reviewer**
1. Sign in with the test login and open Instagram → Posts → New post.
2. Paste a JPEG photo link (for example a product photo), write a caption, press "Post on Instagram".
3. After a few seconds the post appears on the connected Instagram account and at the top of the grid.

### Human Agent

**How will your app use this feature?**
Small businesses often cannot answer a customer's question within 24 hours (for example on holidays). With the
Human Agent tag, a person on the business's team can still reply to a customer's DM up to 7 days after the customer
wrote. WAMA sends the tag only for replies typed by a person in the inbox; automatic (assistant) replies are never
sent after 24 hours. The inbox shows how much time is left to reply.

**Steps for the reviewer**
1. Open an Instagram chat where the customer last wrote more than 24 hours ago (less than 7 days).
2. The header shows the days left to reply. Type a reply and send it: it is delivered with the Human Agent tag.

## 4. Screencast script (about 3 minutes)

Record the browser at https://wamacrm.magnetora.in with no other tabs. Speak or caption each step.

1. **Login (0:00)**: sign in with the test login.
2. **Connect (0:15)**: Settings → Instagram → Connect Instagram. Show Meta's login window with the permissions
   list, choose the business and the Instagram account, finish. Settings shows the connected username
   (*instagram_basic*).
3. **DMs (0:50)**: on a phone, send a DM to the business. In Instagram → Chats it appears; open it, reply with text,
   then send a photo. Show both arriving on the phone (*instagram_manage_messages*).
4. **Human Agent (1:30)**: open a chat older than 24 hours, show "Nd left to reply", send a reply (*Human Agent*).
5. **Comments (1:50)**: comment on a post from the phone; in Instagram → Comments press Check now, reply, then hide
   and show a comment. Show the result on the phone (*instagram_manage_comments*).
6. **Publish (2:30)**: Instagram → Posts → New post, photo link and caption, Post on Instagram; show the new post in
   the grid and on the phone (*instagram_content_publish*).

## 5. After it passes

- Switch the app to **Live** (App Dashboard top bar).
- Comment webhooks start arriving; comments and DMs then come in at once instead of on the one-minute check.
