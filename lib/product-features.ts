/**
 * What WAMA CRM Pro includes and how businesses use it, in plain words. Shown on the billing page
 * (and reusable on the website). Every line here describes something the product does today.
 */

export interface FeatureGroup {
  id: string
  title: string
  summary: string
  points: string[]
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'inbox',
    title: 'Shared WhatsApp inbox',
    summary: 'Every customer chat in one place, answered by the right person.',
    points: [
      'One WhatsApp Business number for your whole team',
      'Assign each chat to a teammate so nothing is missed',
      'Agents see only their chats, or everything: you decide',
      'Move a chat into your sales pipeline as a lead in one click',
    ],
  },
  {
    id: 'ai',
    title: 'AI that replies for you',
    summary: 'Answers customers day and night, in the language they write in.',
    points: [
      'Replies 24/7 from your own FAQs and business information',
      'Understands English, Telugu, Hindi, Tenglish, Hinglish and more',
      'Suggests replies and rewrites messages for your team',
      'Summarises and scores every lead, and tags contacts automatically',
    ],
  },
  {
    id: 'commerce',
    title: 'Sell inside WhatsApp',
    summary: 'Customers browse, order and pay without leaving the chat.',
    points: [
      'Your product catalog in WhatsApp, with a cart',
      'Payment by UPI or card through Razorpay, or cash on delivery',
      'Delivery address collected in the chat; order updates sent automatically',
      'AI shopping assistant finds products and answers "where is my order?"',
    ],
  },
  {
    id: 'campaigns',
    title: 'Campaigns and templates',
    summary: 'Reach every customer with offers, launches and reminders.',
    points: [
      'Send WhatsApp campaigns to thousands from an Excel list',
      'Schedule campaigns and see how many were delivered and read',
      'Create every Meta template type and track its approval',
      'Email campaigns too, from your own email address',
    ],
  },
  {
    id: 'flows',
    title: 'Flows and WhatsApp forms',
    summary: 'Automate the questions you answer every day.',
    points: [
      'Build chat flows with buttons and menus, no coding',
      'Start a flow when a customer types a word like "price" or "menu"',
      'WhatsApp Forms for bookings, enquiries and feedback',
      'Flows create leads, tickets and tags in your CRM',
    ],
  },
  {
    id: 'sales',
    title: 'Sales pipeline and support',
    summary: 'Follow every lead to the sale, and every issue to the fix.',
    points: [
      'Pipeline board with stages, deal value and close dates',
      'Sales reports and a leaderboard for your team',
      'Support tickets with priority and an owner',
      'Email alerts the moment a new ticket comes in',
    ],
  },
  {
    id: 'team',
    title: 'Team, contacts and control',
    summary: 'Grow the team without paying per person.',
    points: [
      'Unlimited team members on one plan',
      'Owner, Admin, Manager, Agent and Viewer roles',
      'Import contacts from Excel or CSV and organise them with tags',
      'Built by an official Meta Tech Provider, on your own number',
    ],
  },
]

export interface UseCase {
  id: string
  business: string
  headline: string
  steps: string[]
}

export const USE_CASES: UseCase[] = [
  {
    id: 'retail',
    business: 'Shops and bookstores',
    headline: '"Me daggara ee book unnaya?" answered in seconds',
    steps: ['AI finds the product in your catalog and sends it with the price', 'Customer adds to cart and pays by UPI in the chat', 'Order updates go out on their own'],
  },
  {
    id: 'd2c',
    business: 'Online brands',
    headline: 'Launch a new product to every customer',
    steps: ['Send the launch offer to your whole list as a campaign', 'Buyers order straight from the message', 'See who read it and follow up on the chats'],
  },
  {
    id: 'clinics',
    business: 'Clinics and salons',
    headline: 'Bookings without phone calls',
    steps: ['A WhatsApp Form takes the name, date and time', 'Your team confirms from the shared inbox', 'Send reminders and offers as scheduled campaigns'],
  },
  {
    id: 'education',
    business: 'Schools and coaching',
    headline: 'Fee and course questions answered 24/7',
    steps: ['AI answers from your course details', 'Every enquiry becomes a lead in the pipeline', 'Batch updates reach all students at once'],
  },
  {
    id: 'real-estate',
    business: 'Real estate and services',
    headline: 'No enquiry from your ads goes cold',
    steps: ['A flow asks budget and location first', 'The lead is assigned to a salesperson', 'Track it on the pipeline until the deal closes'],
  },
  {
    id: 'support',
    business: 'Service and support teams',
    headline: 'One number, many agents, every issue tracked',
    steps: ['Chats are shared and assigned across the team', 'Problems become tickets with an owner', 'Managers see everything; agents see their own'],
  },
]
