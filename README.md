# WhatsApp CRM

A modern, fully-featured CRM application with real-time WhatsApp integration powered by Twilio and Supabase.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)

## 🚀 Features

### Core CRM
- **Lead Management** - Track prospects through customizable sales pipeline
- **Contact Database** - Store and organize unlimited customer information
- **Conversation History** - View all WhatsApp interactions in one place
- **Real-time Updates** - See messages and changes instantly across the team

### WhatsApp Integration
- **Send & Receive Messages** - Direct WhatsApp communication through Twilio
- **Webhook Integration** - Automatically log incoming messages
- **Contact Creation** - Automatically create contacts from WhatsApp conversations
- **Message Tracking** - Link conversations to leads and track deal progress

### Team Features
- **Multi-User** - Multiple team members can access the CRM
- **Role-Based Access** - Owner, Admin, and Member roles
- **Organization Support** - Separate data for each organization/team
- **Row Level Security** - Encrypted data access with RLS policies

## 📋 Prerequisites

- Node.js 18 or higher
- pnpm (or npm/yarn)
- Supabase project
- Twilio account

## 🔧 Quick Start

### 1. Clone & Install

```bash
git clone <repository>
cd whatsapp-crm
pnpm install
```

### 2. Set Up Environment

```bash
cp .env.local.example .env.local
```

Fill in your credentials:
- Supabase: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`

### 3. Configure Database

The database schema is automatically created via Supabase migration:
- Organizations
- Users
- Contacts
- Leads
- Conversations
- Messages
- Pipeline Stages

All tables include Row Level Security (RLS) policies.

### 4. Run Development Server

```bash
pnpm dev
```

Open http://localhost:3000 in your browser.

### 5. Set Up Twilio Webhook

See [TWILIO_SETUP.md](./TWILIO_SETUP.md) for detailed instructions.

## 📱 User Workflows

### Creating an Account

1. Go to `/signup`
2. Enter your name, company, email, and password
3. Click "Create Account"
4. Default organization and pipeline stages are created automatically
5. You're ready to add contacts and start messaging

### Adding Contacts

1. Navigate to **Contacts** tab
2. Click **Add Contact**
3. Enter phone number (required), name, email, company
4. Contact can receive or send WhatsApp messages

### Creating Leads

1. Go to **Leads** tab
2. Click **Add Lead**
3. Select contact, add title, description, and deal value
4. Drag between pipeline stages to track progress

### Messaging

1. **Main Dashboard** shows all active conversations
2. Select a conversation to open chat
3. Type a message and press Enter or click Send
4. Messages are stored in database and sent via Twilio WhatsApp API

### Pipeline Management

- Visual Kanban board with customizable stages
- Drag and drop leads between stages
- Track deal value and priority
- Assign leads to team members

## 📊 API Endpoints

### Incoming Messages
```
POST /api/webhooks/twilio
```
Receives incoming WhatsApp messages from Twilio. Automatically:
- Creates/updates contacts from phone number
- Creates conversations
- Stores messages
- Updates conversation timestamp

### Sending Messages
```
POST /api/messages/send
Body: { conversationId: string, messageBody: string }
```
Sends a WhatsApp message and stores it in database.

## 🏗️ Architecture

### Frontend
- **Framework**: Next.js 16 with App Router
- **UI**: React with Tailwind CSS and shadcn/ui components
- **State**: React hooks and Supabase client for real-time updates
- **Auth**: Supabase Auth with JWT sessions

### Backend
- **Server**: Next.js API Routes
- **Database**: Supabase PostgreSQL with RLS
- **Messaging**: Twilio WhatsApp API
- **Authentication**: Supabase Auth with role-based access

### Database Schema

**organizations**
- id (UUID)
- name, slug
- Timestamps

**users**
- id (UUID, references auth.users)
- organization_id
- email, full_name, role
- Timestamps

**contacts**
- id (UUID)
- organization_id
- phone_number (unique per org)
- email, first_name, last_name, company
- tags array
- Timestamps

**conversations**
- id (UUID)
- organization_id, contact_id, lead_id
- is_active, last_message_at, unread_count
- assigned_to (user)
- Timestamps

**messages**
- id (UUID)
- organization_id, conversation_id
- sender_type ('user' or 'contact')
- body, media_url
- twilio_message_sid
- Timestamps

**leads**
- id (UUID)
- organization_id, contact_id
- title, description, value, priority
- pipeline_stage_id, assigned_to
- Timestamps

**pipeline_stages**
- id (UUID)
- organization_id
- name, color, position
- Timestamps

## 🔐 Security

### Row Level Security (RLS)
- All tables have RLS policies enabled
- Users can only access their organization's data
- Queries are scoped by `organization_id`
- Session user ID validated on every query

### Authentication
- Supabase Auth with email/password
- JWT tokens stored securely
- Password hashing with bcrypt
- Session expiry handling

### API Security
- Twilio webhook signature verification (optional)
- Environment variables for sensitive data
- CORS configured for Twilio webhooks
- Rate limiting recommended for production

## 📦 Dependencies

### Core
- `next` - React framework
- `react` - UI library
- `@supabase/supabase-js` - Database client
- `@supabase/auth-helpers-nextjs` - Auth helpers
- `twilio` - WhatsApp messaging

### UI
- `tailwindcss` - Utility CSS
- `shadcn/ui` - Component library
- `lucide-react` - Icons

### Dev
- `typescript` - Type safety
- `tailwindcss` - CSS framework
- `@types/react` - React types

## 🚀 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Connect repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy automatically on push

### Custom Server

1. Install dependencies: `pnpm install`
2. Build: `pnpm build`
3. Start: `pnpm start`
4. Set `NEXT_PUBLIC_APP_URL` to your domain
5. Update Twilio webhook URL in console

## 🔄 Real-time Features

### Supabase Realtime
The app subscribes to real-time changes:
- Incoming messages instantly appear
- Conversation status updates live
- Pipeline changes reflected immediately
- Unread counts update in real-time

To enable/disable: Check `app/dashboard/page.tsx` for subscription setup.

## 📝 Logging

### Development
- Console logs show API calls and errors
- Use `[v0]` prefix for custom debug logs
- Check browser DevTools for client-side logs
- Server logs shown in terminal

### Production
- Errors logged to console (can integrate Sentry)
- Twilio webhook logs in Twilio Console
- Database errors logged through Supabase

## 🐛 Troubleshooting

### Common Issues

**Webhook URL unreachable**
- Ensure app is deployed to public URL
- Wait for DNS propagation (5-10 min)
- Check firewall/security settings

**Messages not syncing**
- Verify Twilio credentials in environment
- Check webhook URL in Twilio Console
- Ensure organization exists in database

**Authentication failing**
- Clear browser cookies
- Check Supabase URL and key
- Verify user email is confirmed

**Database connection errors**
- Check Supabase status page
- Verify RLS policies are enabled
- Check environment variables

See [SETUP.md](./SETUP.md) and [TWILIO_SETUP.md](./TWILIO_SETUP.md) for detailed guides.

## 📚 Documentation

- [SETUP.md](./SETUP.md) - Complete setup guide
- [TWILIO_SETUP.md](./TWILIO_SETUP.md) - Twilio integration steps
- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Twilio Docs](https://www.twilio.com/docs)

## 🤝 Contributing

This is a starter CRM. Feel free to extend with:
- Tags and filtering
- Advanced reporting/analytics
- Custom pipeline stages
- SMS/Email integration
- File uploads
- Integrations (Calendly, Stripe, etc.)

## 📄 License

MIT License - feel free to use and modify

## 🆘 Support

- Read the [SETUP.md](./SETUP.md) guide first
- Check [TWILIO_SETUP.md](./TWILIO_SETUP.md) for messaging issues
- Review Twilio webhook logs in Console
- Check Supabase logs in dashboard

## 🎯 Roadmap

Potential future features:
- [ ] SMS messaging (Twilio SMS)
- [ ] Email integration
- [ ] Call history tracking
- [ ] Advanced analytics dashboard
- [ ] Custom fields for contacts/leads
- [ ] Integration with Salesforce/HubSpot
- [ ] Mobile app (React Native)
- [ ] AI-powered suggestions
- [ ] Automated workflows
- [ ] Multi-channel messaging

---

Built with ❤️ using Next.js, Supabase, and Twilio
