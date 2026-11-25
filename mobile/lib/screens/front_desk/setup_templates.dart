import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../templates/auto_messages_screen.dart';

/// Front Desk → Setup → Message templates: the WhatsApp template for each automatic message (bill, booking,
/// reminder, feedback). As on the web: send the suggested wording to Meta for approval as it is or after editing
/// it, see where it stands, edit and send it again when Meta rejects it, or use an approved template you already
/// have. Customers who have not written in 24 hours get only these; nothing goes from a template until it is set up.
class TemplatesSetup extends StatelessWidget {
  const TemplatesSetup({super.key});

  @override
  Widget build(BuildContext context) => AutoMessagesScreen(
    title: 'Message templates',
    path: '/api/salon/templates',
    intro: 'WhatsApp needs an approved template for customers who have not written to you in the last 24 hours. Send the suggested wording for approval, or change it first.',
    // Setup counts the messages set up
    onChanged: (context) => AppScope.read(context).load('setup', '/api/salon/setup', force: true),
  );
}
