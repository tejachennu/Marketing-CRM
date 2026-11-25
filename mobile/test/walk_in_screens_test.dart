import 'package:wama_mobile/data/demo_backend.dart';

import 'screen_check.dart';

/// The screens that change for a shop that takes no appointments (Front Desk → Setup → Appointments off): today's
/// walk-in bills, Setup with the switch off, WhatsApp settings without booking parts, the website settings with Book
/// now unavailable, and More without the booking flow. Same sizes as screens_test.dart.
void main() {
  screenChecks(
    backend: () => DemoBackend(appointments: false),
    screens: ['desk', 'bills', 'setup', 'setup_whatsapp', 'setup_templates', 'website_settings', 'more'],
  );
}
