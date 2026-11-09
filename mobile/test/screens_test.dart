import 'screen_check.dart';

/// Every screen except campaigns (campaign_screens_test.dart), and the sheets behind a tap.
void main() {
  screenChecks(
    screens: [
      'login', 'signup', 'signup_code', 'desk', 'bills', 'reviews', 'team', 'setup', 'setup_services', 'setup_team', 'setup_business', //
      'setup_whatsapp', 'setup_templates', 'checkout', 'new_bill', 'new_booking', 'appointment', 'bill', 'booking_flow', 'chats', 'chat', //
      'chat_ai', 'chat_closed', 'contacts', 'new_contact', 'templates', 'template', 'more', 'sync', 'knowledge', 'article', 'assistant',
    ],
    flows: [
      ('setup_services', ['Haircut (Women)']),
      ('setup_services', ['Categories']),
      ('setup_services', ['Add service']),
      ('setup_team', ['Anitha']),
      ('setup_team', ['Add person']),
      ('setup_templates', ['Bill']),
      ('setup_templates', ['Booking confirmed']),
      ('setup_templates', ['Booking confirmed', 'Use suggested']),
      ('new_bill', ['Haircut (Men)', 'Gold facial']),
      ('new_booking', ['Haircut (Men)']),
      ('checkout', ['Manicure']),
      ('bill', ['Cancel this bill']),
      ('appointment', ['Done · make the bill']),
      ('reviews', ['To call back · 1']),
      ('booking_flow', ['2. Pick services']),
    ],
  );
}
