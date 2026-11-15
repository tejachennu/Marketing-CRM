import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Chat and tickets settings (as on the web's Settings → Chat and tickets): AI replies on or off,
/// the chatbot's instructions, and who gets an email when a ticket is raised. For admins.
class ChatTicketsScreen extends StatefulWidget {
  const ChatTicketsScreen({super.key});
  @override
  State<ChatTicketsScreen> createState() => _ChatTicketsScreenState();
}

class _ChatTicketsScreenState extends State<ChatTicketsScreen> {
  bool _loading = true, _saving = false;
  String _error = '';
  bool _ai = true;
  bool _emails = false;
  final Set<String> _recipients = {};
  final _prompt = TextEditingController();
  List<Map<String, dynamic>> _team = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _prompt.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    final q = {'organizationId': app.orgId};
    try {
      final results = await Future.wait([app.backend.get('/api/organization', q), app.backend.get('/api/teammates', q).catchError((_) => <String, dynamic>{})]);
      final org = Map<String, dynamic>.from(results[0]['organization'] as Map? ?? const {});
      if (!mounted) return;
      setState(() {
        _ai = org['enable_ai'] != false;
        _emails = org['ticket_email_enabled'] == true;
        _recipients
          ..clear()
          ..addAll([for (final id in (org['ticket_email_recipients'] as List? ?? const [])) '$id']);
        _prompt.text = '${org['chatbot_base_prompt'] ?? ''}';
        _team = [for (final t in (results[1]['teammates'] as List? ?? const [])) Map<String, dynamic>.from(t as Map)];
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _loading = false;
        });
      }
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await AppScope.read(context).ask('/api/organization', {
        'updates': {
          'enable_ai': _ai,
          'chatbot_base_prompt': _prompt.text.trim().isEmpty ? null : _prompt.text.trim(),
          'ticket_email_enabled': _emails,
          'ticket_email_recipients': _recipients.toList(),
        },
      }, method: 'PATCH');
      if (mounted) toast(context, _emails && _recipients.isEmpty ? 'Saved. Tick at least one person to get ticket emails.' : 'Chat and ticket settings saved.');
    } catch (e) {
      if (mounted) toast(context, '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Chat and tickets')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
          ? EmptyState(icon: Icons.settings_outlined, title: 'Settings could not be loaded', text: _error)
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                const SectionLabel('Chat'),
                Card(
                  child: SwitchListTile(
                    value: _ai,
                    onChanged: (v) => setState(() => _ai = v),
                    title: const Text('AI replies and suggestions', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('The AI chatbot answers customers from your Knowledge Base, and suggests replies in chats.'),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _prompt,
                  minLines: 4,
                  maxLines: 10,
                  decoration: const InputDecoration(
                    labelText: 'Chatbot instructions (optional)',
                    alignLabelWithHint: true,
                    hintText: 'For example: Reply in the customer\'s language. Never promise a delivery date. Hand over to the team for refunds.',
                    helperText: 'How the AI talks and what it must never do. Leave empty for the standard polite helper.',
                    helperMaxLines: 3,
                  ),
                ),
                const SectionLabel('Tickets'),
                Card(
                  child: SwitchListTile(
                    value: _emails,
                    onChanged: (v) => setState(() => _emails = v),
                    title: const Text('Email when a ticket is raised', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('When a customer needs your team. Pop-ups on the app come anyway; this adds an email.'),
                  ),
                ),
                if (_emails) ...[
                  const Padding(
                    padding: EdgeInsets.fromLTRB(4, 12, 4, 6),
                    child: Text(
                      'Who gets the email',
                      style: TextStyle(fontWeight: FontWeight.w600, color: Brand.muted),
                    ),
                  ),
                  if (_team.isEmpty)
                    const Text('No team members found. Add people from Team on the web.', style: TextStyle(color: Brand.muted))
                  else
                    Card(
                      child: Column(
                        children: [
                          for (final person in _team)
                            CheckboxListTile(
                              value: _recipients.contains('${person['id']}'),
                              onChanged: (v) => setState(() => v == true ? _recipients.add('${person['id']}') : _recipients.remove('${person['id']}')),
                              title: Text('${person['full_name'] ?? person['email'] ?? 'Team member'}'),
                              subtitle: Text('${person['email'] ?? ''}'),
                            ),
                        ],
                      ),
                    ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save'),
                ),
              ],
            ),
    );
  }
}
