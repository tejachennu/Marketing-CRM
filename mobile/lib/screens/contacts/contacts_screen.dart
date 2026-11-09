import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

List<Map<String, dynamic>> contactsOf(AppState app) {
  final waiting = [
    for (final item in app.pending('contact'))
      {
        'id': item.id,
        'first_name': item.body['firstName'],
        'last_name': item.body['lastName'],
        'phone_number': item.body['phoneNumber'],
        'email': item.body['email'],
        'tags': item.body['tags'] ?? [],
        '_waiting': true,
        '_failed': item.state.name == 'failed',
      },
  ];
  final saved = [for (final c in ((app.cached('contacts') ?? const {})['contacts'] as List? ?? const [])) Map<String, dynamic>.from(c)];
  return [...waiting.reversed, ...saved];
}

/// Contacts, searchable offline; new ones are saved on the phone and sync later.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});
  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  String _query = '';
  String? _tag;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final all = contactsOf(app);
    final tags = <String>{
      for (final c in all)
        for (final t in (c['tags'] as List? ?? const [])) '$t',
    }.toList()..sort();
    final q = _query.toLowerCase();
    final digits = _query.replaceAll(RegExp(r'\D'), '');
    final shown = all.where((c) {
      if (_tag != null && !(c['tags'] as List? ?? const []).contains(_tag)) return false;
      if (q.isEmpty) return true;
      return contactName(c).toLowerCase().contains(q) || (digits.length >= 3 && '${c['phone_number'] ?? ''}'.replaceAll(RegExp(r'\D'), '').contains(digits));
    }).toList();
    return Scaffold(
      appBar: AppBar(title: Text('Contacts · ${all.length}')),
      floatingActionButton: app.can('write')
          ? FloatingActionButton.extended(
              backgroundColor: Brand.blue,
              foregroundColor: Colors.white,
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewContactScreen())),
              icon: const Icon(Icons.person_add_alt_1),
              label: const Text('Add contact', style: TextStyle(fontWeight: FontWeight.w700)),
            )
          : null,
      body: Column(
        children: [
          const SyncBanner(cacheKey: 'contacts'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search name or number'),
              onChanged: (v) => setState(() => _query = v.trim()),
            ),
          ),
          if (tags.isNotEmpty)
            SizedBox(
              height: 52,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                children: [
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(label: const Text('Everyone'), selected: _tag == null, onSelected: (_) => setState(() => _tag = null)),
                  ),
                  for (final t in tags)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(label: Text(t), selected: _tag == t, onSelected: (_) => setState(() => _tag = t)),
                    ),
                ],
              ),
            ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: app.syncNow,
              child: shown.isEmpty
                  ? ListView(
                      children: const [EmptyState(icon: Icons.people_outline, title: 'No contacts found', text: 'Try another name or number.')],
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.only(bottom: 96),
                      itemCount: shown.length,
                      separatorBuilder: (_, _) => const Divider(indent: 72),
                      itemBuilder: (context, index) {
                        final c = shown[index];
                        final tags = (c['tags'] as List? ?? const []);
                        return Container(
                          color: Colors.white,
                          child: ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                            leading: Avatar(contactName(c), size: 42),
                            title: Text(contactName(c), style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text('${c['phone_number'] ?? 'No number'}', style: const TextStyle(color: Brand.muted)),
                            trailing: c['_waiting'] == true
                                ? WaitingPill(failed: c['_failed'] == true)
                                : tags.isEmpty
                                ? null
                                : Pill('${tags.first}', tone: tags.first == 'VIP' ? PillTone.blue : PillTone.grey),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class NewContactScreen extends StatefulWidget {
  const NewContactScreen({super.key});
  @override
  State<NewContactScreen> createState() => _NewContactScreenState();
}

class _NewContactScreenState extends State<NewContactScreen> {
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _email = TextEditingController();
  String _phone = '';
  final Set<String> _tags = {};

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final known = <String>{
      for (final c in contactsOf(app))
        for (final t in (c['tags'] as List? ?? const [])) '$t',
      'VIP',
      'Regular',
      'New',
    }.toList()..sort();
    return Scaffold(
      appBar: AppBar(title: const Text('New contact')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _first,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(labelText: 'First name'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _last,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(labelText: 'Last name'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                PhoneField(value: _phone, onChanged: (v) => _phone = v, label: 'WhatsApp number'),
                const SizedBox(height: 12),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email (optional)'),
                ),
                const SectionLabel('Tags'),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [for (final t in known) FilterChip(label: Text(t), selected: _tags.contains(t), onSelected: (on) => setState(() => on ? _tags.add(t) : _tags.remove(t)))],
                ),
                const SizedBox(height: 10),
                const Text('Tags let you send a campaign to a group, like VIP customers.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Brand.line)),
          ),
          child: FilledButton.icon(
            onPressed: () async {
              if (_first.text.trim().isEmpty || _phone.isEmpty) return toast(context, 'Give a first name and a WhatsApp number.');
              final name = '${_first.text.trim()} ${_last.text.trim()}'.trim();
              await app.enqueue(
                kind: 'contact',
                label: 'New contact: $name',
                path: '/api/contacts',
                body: {'organizationId': app.orgId, 'firstName': _first.text.trim(), 'lastName': _last.text.trim(), 'phoneNumber': _phone, 'email': _email.text.trim(), 'tags': _tags.toList()},
              );
              if (!context.mounted) return;
              toast(context, app.online ? '$name saved.' : '$name saved on the phone. It syncs when you are online.');
              Navigator.pop(context);
            },
            icon: const Icon(Icons.check),
            label: const Text('Save contact'),
          ),
        ),
      ),
    );
  }
}
