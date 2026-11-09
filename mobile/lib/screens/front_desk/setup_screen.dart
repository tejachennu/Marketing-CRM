import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../data/format.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';
import '../../ui/widgets.dart';
import 'booking_flow_screen.dart';
import 'catalog_history.dart';
import 'setup_templates.dart';

/// Front Desk setup, as on the web: services and categories, the team, business details and
/// logo, WhatsApp (assistant, hours, reminders, feedback), the booking flow and message
/// templates. Changes need the internet (they are saved on the server straight away).

const businessTypes = {
  'salon': ('Salon & spa', 'Hair, skin, nails, spa', Icons.content_cut),
  'clinic': ('Clinic', 'Doctors, dental, physio, lab', Icons.medical_services_outlined),
  'fitness': ('Fitness & yoga', 'Gym, yoga, dance, diet', Icons.fitness_center),
  'repair': ('Repair & service', 'Mobiles, laptops, home, vehicles', Icons.build_outlined),
  'other': ('Something else', 'Any business that takes appointments', Icons.storefront_outlined),
};

Map<String, dynamic> setupOf(AppState app) => Map<String, dynamic>.from(app.cached('setup') ?? const {});
List<Map<String, dynamic>> allServices(AppState app) => [for (final s in (setupOf(app)['services'] as List? ?? const [])) Map<String, dynamic>.from(s)];
List<Map<String, dynamic>> allStaff(AppState app) => [for (final s in (setupOf(app)['staff'] as List? ?? const [])) Map<String, dynamic>.from(s)];
Map<String, dynamic> settingsOf(AppState app) => Map<String, dynamic>.from(setupOf(app)['settings'] as Map? ?? const {});

/// Save something on the server, then bring the setup up to date. Shows what went wrong.
Future<bool> saveSetup(BuildContext context, Future<Object?> Function(AppState app) task, {String? done}) async {
  final app = AppScope.read(context);
  try {
    await task(app);
    await app.load('setup', '/api/salon/setup', force: true);
    if (done != null && context.mounted) toast(context, done);
    return true;
  } catch (e) {
    if (context.mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    return false;
  }
}

class SetupScreen extends StatelessWidget {
  const SetupScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final services = allServices(app);
    final staff = allStaff(app);
    final settings = settingsOf(app);
    final templates = (settings['message_templates'] as Map? ?? const {}).values.where((v) => v != null).length;
    Widget tile(IconData icon, String title, String subtitle, Widget screen, {bool attention = false}) => ListTile(
      leading: Icon(icon, color: Brand.navy),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(
        subtitle,
        style: TextStyle(color: attention ? Brand.red : Brand.muted, fontWeight: attention ? FontWeight.w600 : FontWeight.w400),
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => screen)),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Front Desk setup')),
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (services.isEmpty) const _StarterKit(),
                Card(
                  child: Column(
                    children: [
                      tile(
                        Icons.content_cut,
                        'Services',
                        services.isEmpty
                            ? 'No services yet'
                            : '${services.where((s) => s['active'] != false).length} of ${services.length} on offer${services.any((s) => s['billable'] == false) ? ' · ${services.where((s) => s['billable'] == false).length} not on bills' : ''} · catalog',
                        const ServicesSetup(),
                        attention: services.isEmpty,
                      ),
                      const Divider(indent: 56),
                      tile(Icons.groups_outlined, 'Team', staff.isEmpty ? 'No one yet' : '${staff.length} people · commission', const StaffSetup()),
                      const Divider(indent: 56),
                      tile(Icons.storefront_outlined, 'Business details', 'Name, address, GSTIN, logo on bills', const BusinessSetup()),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Column(
                    children: [
                      tile(Icons.chat_outlined, 'WhatsApp', 'Assistant, opening hours, reminders, feedback', const WhatsAppSetup()),
                      const Divider(indent: 56),
                      tile(Icons.event_available_outlined, 'Booking flow', ((settings['booking_flow'] as Map?)?['enabled'] == true) ? 'On · customers book in taps' : 'Off', const BookingFlowScreen()),
                      const Divider(indent: 56),
                      tile(
                        Icons.description_outlined,
                        'Message templates',
                        templates == 4 ? 'All 4 set up' : '$templates of 4 set up · needed after 24 hours',
                        const TemplatesSetup(),
                        attention: templates < 4,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Card(child: tile(Icons.history, 'Change history', 'Who changed what, and when', const HistoryScreen())),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StarterKit extends StatelessWidget {
  const _StarterKit();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('What kind of business is this?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            const Text('Pick one to start with a ready list of services, prices and a small team. Change anything later.', style: TextStyle(color: Brand.textSoft)),
            const SizedBox(height: 12),
            for (final e in businessTypes.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(alignment: Alignment.centerLeft, padding: const EdgeInsets.all(12)),
                  onPressed: () => saveSetup(context, (app) => app.ask('/api/salon/sample', {'business_type': e.key}), done: 'Added a starter list. Change anything below.'),
                  child: Row(
                    children: [
                      Icon(e.value.$3, color: Brand.blue),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(e.value.$1, style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text(
                              e.value.$2,
                              style: const TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w400),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ── Services and categories ──

class ServicesSetup extends StatelessWidget {
  const ServicesSetup({super.key});
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final services = allServices(app);
    final order = <String>[];
    for (final c in [...(settingsOf(app)['service_categories'] as List? ?? const []), ...services.map((s) => s['category'] ?? 'General')]) {
      if (!order.any((x) => x.toLowerCase() == '$c'.toLowerCase())) order.add('$c');
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Services'),
        actions: [
          IconButton(
            tooltip: 'Add from catalog',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CatalogScreen())),
            icon: const Icon(Icons.inventory_2_outlined),
          ),
          IconButton(
            tooltip: 'Categories',
            onPressed: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => const _CategoriesSheet()),
            icon: const Icon(Icons.label_outline),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-services',
        backgroundColor: Brand.blue,
        foregroundColor: Colors.white,
        onPressed: () => _editService(context, null, order),
        icon: const Icon(Icons.add),
        label: const Text('Add service', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        children: [
          if (services.isEmpty)
            EmptyState(
              icon: Icons.content_cut,
              title: 'No services yet',
              text: 'Add what you offer, with prices and how long each takes, or pick items from your product catalog.',
              action: OutlinedButton.icon(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CatalogScreen())),
                icon: const Icon(Icons.inventory_2_outlined),
                label: const Text('Add from catalog'),
              ),
            ),
          if (services.isNotEmpty)
            Card(
              child: ListTile(
                leading: const Icon(Icons.inventory_2_outlined, color: Brand.blue),
                title: const Text('Add from your catalog', style: TextStyle(fontWeight: FontWeight.w700)),
                subtitle: const Text('Tick many products at once'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CatalogScreen())),
              ),
            ),
          for (final category in order) ...[
            SectionLabel('$category · ${services.where((s) => '${s['category'] ?? 'General'}'.toLowerCase() == category.toLowerCase()).length}'),
            Card(
              child: Column(
                children: [
                  for (final s in services.where((s) => '${s['category'] ?? 'General'}'.toLowerCase() == category.toLowerCase()))
                    ListTile(
                      onTap: () => _editService(context, s, order),
                      leading: (s['image_url'] != null || s['source'] == 'catalog') ? ItemThumb(url: s['image_url'] as String?, size: 40) : null,
                      title: Text(
                        '${s['name']}',
                        style: TextStyle(fontWeight: FontWeight.w700, color: s['active'] == false ? Brand.faint : Brand.text, decoration: s['active'] == false ? TextDecoration.lineThrough : null),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${formatRupees(s['price'])} · ${s['duration_minutes']} min · GST ${s['tax_rate'] ?? 0}%'),
                          if (s['billable'] == false || s['source'] == 'catalog')
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Wrap(
                                spacing: 6,
                                runSpacing: 4,
                                children: [
                                  if (s['billable'] == false) const Pill('Not on bills', tone: PillTone.red, icon: Icons.receipt_long_outlined),
                                  if (s['source'] == 'catalog') const Pill('Catalog', tone: PillTone.blue, icon: Icons.inventory_2_outlined),
                                ],
                              ),
                            ),
                        ],
                      ),
                      trailing: Switch(
                        value: s['active'] != false,
                        activeThumbColor: Colors.white,
                        activeTrackColor: Brand.blue,
                        onChanged: (v) => saveSetup(context, (app) => app.ask('/api/salon/services', {'id': s['id'], 'active': v}, method: 'PATCH')),
                      ),
                    ),
                  if (!services.any((s) => '${s['category'] ?? 'General'}'.toLowerCase() == category.toLowerCase()))
                    ListTile(
                      title: const Text('No services in this category yet', style: TextStyle(color: Brand.muted)),
                      trailing: TextButton(onPressed: () => _editService(context, {'category': category}, order), child: const Text('Add one')),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

Future<void> _editService(BuildContext context, Map<String, dynamic>? service, List<String> categories) async {
  final editing = service?['id'] != null;
  final name = TextEditingController(text: service?['name'] ?? '');
  final price = TextEditingController(text: service?['price'] == null ? '' : '${service!['price']}');
  final minutes = TextEditingController(text: '${service?['duration_minutes'] ?? 30}');
  final sac = TextEditingController(text: service?['sac_code'] ?? '');
  final newCategory = TextEditingController();
  var category = '${service?['category'] ?? (categories.isEmpty ? 'General' : categories.first)}';
  var tax = (num.tryParse('${service?['tax_rate'] ?? 18}') ?? 18).toInt();
  var active = service?['active'] != false;
  var billable = service?['billable'] != false;
  var tried = false;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, set) {
        final priceValue = num.tryParse(price.text.replaceAll(',', ''));
        final minuteValue = int.tryParse(minutes.text);
        final nameErr = tried ? textError(name.text, what: 'the service name', min: 2, max: 80) : null;
        final priceErr = tried && (priceValue == null || priceValue < 0 || priceValue > 1000000) ? 'Enter a price from ₹0 to ₹10,00,000.' : null;
        final minutesErr = tried && (minuteValue == null || minuteValue < 5 || minuteValue > 600) ? 'Between 5 minutes and 10 hours.' : null;
        final sacErr = tried && sac.text.trim().isNotEmpty && !RegExp(r'^\d{4,8}$').hasMatch(sac.text.trim()) ? 'A SAC code is 4 to 8 digits.' : null;
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(sheet).viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(editing ? 'Edit service' : 'Add a service', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                TextField(
                  controller: name,
                  textCapitalization: TextCapitalization.sentences,
                  onChanged: (_) => set(() {}),
                  decoration: InputDecoration(labelText: 'Service name', hintText: 'Haircut', errorText: nameErr),
                ),
                const SizedBox(height: 12),
                const Text('Category', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [for (final c in categories) ChoiceChip(label: Text(c), selected: category == c, onSelected: (_) => set(() => category = c))],
                ),
                TextField(
                  controller: newCategory,
                  onChanged: (v) => set(() => category = v.trim().isEmpty ? (categories.isEmpty ? 'General' : categories.first) : v.trim()),
                  decoration: const InputDecoration(hintText: 'Or type a new category'),
                ),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: price,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) => set(() {}),
                        decoration: InputDecoration(labelText: 'Price (₹)', errorText: priceErr, errorMaxLines: 2),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: minutes,
                        keyboardType: TextInputType.number,
                        onChanged: (_) => set(() {}),
                        decoration: InputDecoration(labelText: 'Minutes', errorText: minutesErr, errorMaxLines: 2),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  children: [
                    for (final m in [15, 30, 45, 60, 90, 120]) ChoiceChip(label: Text('$m min'), selected: minutes.text == '$m', onSelected: (_) => set(() => minutes.text = '$m')),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('GST', style: TextStyle(fontWeight: FontWeight.w700)),
                Wrap(
                  spacing: 6,
                  children: [
                    for (final r in [0, 5, 12, 18, 28]) ChoiceChip(label: Text('$r%'), selected: tax == r, onSelected: (_) => set(() => tax = r)),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: sac,
                  keyboardType: TextInputType.number,
                  onChanged: (_) => set(() {}),
                  decoration: InputDecoration(labelText: 'SAC code (optional)', hintText: '999721', errorText: sacErr),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: active,
                  activeThumbColor: Colors.white,
                  activeTrackColor: Brand.blue,
                  onChanged: (v) => set(() => active = v),
                  title: const Text('On offer', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: const Text('Off: not offered for new bookings and bills'),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: billable,
                  activeThumbColor: Colors.white,
                  activeTrackColor: Brand.blue,
                  onChanged: (v) => set(() => billable = v),
                  title: const Text('Use in bills', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: const Text('Off: customers can still book it, but it never goes on a bill'),
                ),
                if (service?['source'] == 'catalog')
                  const Padding(
                    padding: EdgeInsets.only(bottom: 4),
                    child: Row(
                      children: [
                        Icon(Icons.inventory_2_outlined, size: 16, color: Brand.muted),
                        SizedBox(width: 6),
                        Expanded(
                          child: Text('From your catalog. The sync button in Add from catalog brings over new names and prices.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    if (editing)
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(foregroundColor: Brand.red),
                          onPressed: () async {
                            final ok = await _confirm(sheet, 'Remove ${service!['name']}?', 'Past bookings and bills keep it. It stops being offered.');
                            if (!ok || !sheet.mounted) return;
                            if (await saveSetup(sheet, (app) => app.ask('/api/salon/services?organizationId=${app.orgId}&id=${service['id']}', {}, method: 'DELETE'), done: 'Removed.') &&
                                sheet.mounted) {
                              Navigator.pop(sheet);
                            }
                          },
                          child: const Text('Remove'),
                        ),
                      ),
                    if (editing) const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        onPressed: () async {
                          set(() => tried = true);
                          if (textError(name.text, what: 'the service name', min: 2, max: 80) != null ||
                              priceValue == null ||
                              priceValue < 0 ||
                              priceValue > 1000000 ||
                              minuteValue == null ||
                              minuteValue < 5 ||
                              minuteValue > 600) {
                            return;
                          }
                          if (sac.text.trim().isNotEmpty && !RegExp(r'^\d{4,8}$').hasMatch(sac.text.trim())) return;
                          final body = {
                            if (editing) 'id': service!['id'],
                            'name': name.text.trim(),
                            'category': category,
                            'price': priceValue,
                            'duration_minutes': minuteValue,
                            'tax_rate': tax,
                            'sac_code': sac.text.trim().isEmpty ? null : sac.text.trim(),
                            'active': active,
                            'billable': billable,
                          };
                          if (await saveSetup(sheet, (app) => app.ask('/api/salon/services', body, method: editing ? 'PATCH' : 'POST'), done: '${name.text.trim()} saved.') && sheet.mounted) {
                            Navigator.pop(sheet);
                          }
                        },
                        child: const Text('Save'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
}

Future<bool> _confirm(BuildContext context, String title, String text) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(text),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Brand.red),
            child: const Text('Remove'),
          ),
        ],
      ),
    ) ==
    true;

class _CategoriesSheet extends StatefulWidget {
  const _CategoriesSheet();
  @override
  State<_CategoriesSheet> createState() => _CategoriesSheetState();
}

class _CategoriesSheetState extends State<_CategoriesSheet> {
  final _new = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final services = allServices(app);
    final cats = <String>[];
    for (final c in [...(settingsOf(app)['service_categories'] as List? ?? const []), ...services.map((s) => s['category'] ?? 'General')]) {
      if (!cats.any((x) => x.toLowerCase() == '$c'.toLowerCase())) cats.add('$c');
    }
    int count(String c) => services.where((s) => '${s['category'] ?? 'General'}'.toLowerCase() == c.toLowerCase()).length;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Categories', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
          const Text('The order customers and the counter see them in.', style: TextStyle(color: Brand.muted)),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _new,
                  maxLength: 40,
                  decoration: const InputDecoration(hintText: 'New category, like Skin', counterText: ''),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () {
                  final name = _new.text.trim();
                  if (name.isEmpty) return;
                  if (cats.any((c) => c.toLowerCase() == name.toLowerCase())) return toast(context, 'There is already a category called $name.');
                  saveSetup(context, (app) => app.ask('/api/salon/categories', {'name': name}), done: 'Category added.');
                  _new.clear();
                },
                child: const Text('Add'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.5),
            child: ListView(
              shrinkWrap: true,
              children: [
                for (var i = 0; i < cats.length; i++)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(cats[i], style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(count(cats[i]) == 0 ? 'No services' : '${count(cats[i])} services'),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          onPressed: i == 0
                              ? null
                              : () => saveSetup(
                                  context,
                                  (app) => app.ask('/api/salon/categories', {
                                    'categories': [...cats]
                                      ..insert(i - 1, cats[i])
                                      ..removeAt(i + 1),
                                  }, method: 'PUT'),
                                ),
                          icon: const Icon(Icons.arrow_upward, size: 18),
                        ),
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          onPressed: () async {
                            final controller = TextEditingController(text: cats[i]);
                            final to = await showDialog<String>(
                              context: context,
                              builder: (d) => AlertDialog(
                                title: const Text('Rename category'),
                                content: TextField(controller: controller, autofocus: true, maxLength: 40),
                                actions: [
                                  TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
                                  TextButton(onPressed: () => Navigator.pop(d, controller.text.trim()), child: const Text('Save')),
                                ],
                              ),
                            );
                            if (to == null || to.isEmpty || to == cats[i] || !context.mounted) return;
                            saveSetup(context, (app) => app.ask('/api/salon/categories', {'from': cats[i], 'to': to}, method: 'PATCH'), done: 'Renamed. Its services moved too.');
                          },
                          icon: const Icon(Icons.edit_outlined, size: 18),
                        ),
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          onPressed: cats.length == 1 && count(cats[i]) > 0
                              ? null
                              : () async {
                                  final moveTo = cats.firstWhere((c) => c != cats[i], orElse: () => 'General');
                                  final ok = await _confirm(context, 'Remove "${cats[i]}"?', count(cats[i]) > 0 ? 'Its ${count(cats[i])} services move to "$moveTo".' : 'It has no services.');
                                  if (!ok || !context.mounted) return;
                                  saveSetup(
                                    context,
                                    (app) =>
                                        app.ask('/api/salon/categories?organizationId=${app.orgId}&name=${Uri.encodeComponent(cats[i])}&moveTo=${Uri.encodeComponent(moveTo)}', {}, method: 'DELETE'),
                                    done: 'Removed.',
                                  );
                                },
                          icon: const Icon(Icons.delete_outline, size: 18, color: Brand.red),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Team ──

class StaffSetup extends StatelessWidget {
  const StaffSetup({super.key});
  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final staff = allStaff(app);
    final services = allServices(app);
    return Scaffold(
      appBar: AppBar(title: const Text('Team')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-team',
        backgroundColor: Brand.blue,
        foregroundColor: Colors.white,
        onPressed: () => _editStaff(context, null, services),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Add person', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        children: [
          if (staff.isEmpty) const EmptyState(icon: Icons.groups_outlined, title: 'No team yet', text: 'Add the people who serve customers. Bills and bookings can then say who did the work.'),
          for (final m in staff) ...[
            Panel(
              onTap: () => _editStaff(context, m, services),
              child: Row(
                children: [
                  Avatar('${m['name']}', size: 44),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${m['name']}${m['active'] == false ? ' (away)' : ''}',
                          style: TextStyle(fontWeight: FontWeight.w700, color: m['active'] == false ? Brand.faint : Brand.text),
                        ),
                        Text(
                          [
                            (m['service_ids'] as List? ?? const []).isEmpty ? 'All services' : '${(m['service_ids'] as List).length} services',
                            (((num.tryParse('${m['commission_percent'] ?? 0}') ?? 0)) > 0) ? '${m['commission_percent']}% commission' : 'No commission',
                            if (m['phone'] != null) '${m['phone']}',
                          ].join(' · '),
                          style: const TextStyle(fontSize: 12.5, color: Brand.muted),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Brand.faint),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

Future<void> _editStaff(BuildContext context, Map<String, dynamic>? member, List<Map<String, dynamic>> services) async {
  final editing = member != null;
  final name = TextEditingController(text: member?['name'] ?? '');
  var phone = '${member?['phone'] ?? ''}';
  final commission = TextEditingController(text: '${num.tryParse('${member?['commission_percent'] ?? 0}') ?? 0}');
  final serviceIds = <String>{for (final id in (member?['service_ids'] as List? ?? const [])) '$id'};
  var active = member?['active'] != false;
  var tried = false;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, set) {
        final pct = num.tryParse(commission.text);
        final nameErr = tried ? textError(name.text, what: 'a name', max: 60) : null;
        final phoneErr = tried ? phoneError(phone) : null;
        final pctErr = tried && (pct == null || pct < 0 || pct > 100) ? 'Between 0 and 100.' : null;
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.of(sheet).viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(editing ? 'Edit ${member['name']}' : 'Add a person', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                TextField(
                  controller: name,
                  textCapitalization: TextCapitalization.words,
                  onChanged: (_) => set(() {}),
                  decoration: InputDecoration(labelText: 'Name', errorText: nameErr),
                ),
                const SizedBox(height: 12),
                PhoneField(value: phone, label: 'Mobile (optional)', errorText: phoneErr, onChanged: (v) => set(() => phone = v)),
                const SizedBox(height: 12),
                const Text('Commission', style: TextStyle(fontWeight: FontWeight.w700)),
                const Text('Their share of the services they do (before GST, after discounts).', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final p in [0, 10, 20, 30, 40]) ChoiceChip(label: Text(p == 0 ? 'None' : '$p%'), selected: commission.text == '$p', onSelected: (_) => set(() => commission.text = '$p')),
                    SizedBox(
                      width: 110,
                      child: TextField(
                        controller: commission,
                        keyboardType: TextInputType.number,
                        onChanged: (_) => set(() {}),
                        decoration: InputDecoration(suffixText: '%', errorText: pctErr, isDense: true),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('Services they do', style: TextStyle(fontWeight: FontWeight.w700)),
                const Text('Leave all off if they do everything.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final s in services)
                      ChoiceChip(label: Text('${s['name']}'), selected: serviceIds.contains(s['id']), onSelected: (on) => set(() => on ? serviceIds.add('${s['id']}') : serviceIds.remove(s['id']))),
                  ],
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: active,
                  activeThumbColor: Colors.white,
                  activeTrackColor: Brand.blue,
                  onChanged: (v) => set(() => active = v),
                  title: const Text('Working', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: const Text('Off: on leave or no longer with you'),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    if (editing)
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(foregroundColor: Brand.red),
                          onPressed: () async {
                            if (!await _confirm(sheet, 'Remove ${member['name']}?', 'Their past appointments stay on record.') || !sheet.mounted) return;
                            if (await saveSetup(sheet, (app) => app.ask('/api/salon/staff?organizationId=${app.orgId}&id=${member['id']}', {}, method: 'DELETE'), done: 'Removed.') && sheet.mounted) {
                              Navigator.pop(sheet);
                            }
                          },
                          child: const Text('Remove'),
                        ),
                      ),
                    if (editing) const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        onPressed: () async {
                          set(() => tried = true);
                          if (textError(name.text, what: 'a name', max: 60) != null || phoneError(phone) != null || pct == null || pct < 0 || pct > 100) return;
                          final body = {
                            if (editing) 'id': member['id'],
                            'name': name.text.trim(),
                            'phone': phone.isEmpty ? null : phone,
                            'commission_percent': pct,
                            'service_ids': serviceIds.toList(),
                            'active': active,
                          };
                          if (await saveSetup(sheet, (app) => app.ask('/api/salon/staff', body, method: editing ? 'PATCH' : 'POST'), done: '${name.text.trim()} saved.') && sheet.mounted) {
                            Navigator.pop(sheet);
                          }
                        },
                        child: const Text('Save'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
}

// ── Business details and logo ──

final _gstin = RegExp(r'^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

class BusinessSetup extends StatefulWidget {
  const BusinessSetup({super.key});
  @override
  State<BusinessSetup> createState() => _BusinessSetupState();
}

class _BusinessSetupState extends State<BusinessSetup> {
  late final Map<String, dynamic> s = settingsOf(AppScope.read(context));
  late final _name = TextEditingController(text: s['business_name'] ?? '');
  late String _phone = '${s['phone'] ?? ''}';
  late final _address = TextEditingController(text: s['address'] ?? '');
  late final _gst = TextEditingController(text: s['gstin'] ?? '');
  late final _email = TextEditingController(text: s['email'] ?? '');
  late final _prefix = TextEditingController(text: s['invoice_prefix'] ?? 'INV');
  late final _note = TextEditingController(text: s['invoice_note'] ?? '');
  late bool _includeTax = s['prices_include_tax'] == true;
  late String _type = '${s['business_type'] ?? 'salon'}';
  bool _tried = false;
  bool _logoBusy = false;

  String? get _gstErr => _tried && _gst.text.trim().isNotEmpty && !_gstin.hasMatch(_gst.text.trim().toUpperCase()) ? 'A GSTIN has 15 characters, like 36ABCDE1234F1Z5.' : null;
  String? get _prefixErr => _tried && !RegExp(r'^[A-Za-z0-9/-]{1,12}$').hasMatch(_prefix.text.trim()) ? 'Up to 12 letters or numbers, like GLOW.' : null;

  Future<void> _logo(AppState app) async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['png', 'jpg', 'jpeg', 'webp']);
    if (file == null) return;
    setState(() => _logoBusy = true);
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 2 * 1024 * 1024) throw Exception('Use a logo under 2 MB.');
      await app.uploadFile(bytes, file.name, path: '/api/salon/logo', fields: {'organizationId': app.orgId});
      await app.load('setup', '/api/salon/setup', force: true);
      if (mounted) toast(context, 'Logo saved. New bills show it.');
    } catch (e) {
      if (mounted) toast(context, '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _logoBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final logo = settingsOf(app)['logo_url'];
    return Scaffold(
      appBar: AppBar(title: const Text('Business details')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Panel(
            child: Row(
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: Brand.page,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Brand.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: _logoBusy
                      ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
                      : logo != null
                      ? Image.network(
                          '$logo',
                          fit: BoxFit.contain,
                          errorBuilder: (_, _, _) => const Icon(Icons.image_outlined, color: Brand.faint),
                        )
                      : const Icon(Icons.add_photo_alternate_outlined, color: Brand.faint),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Logo', style: TextStyle(fontWeight: FontWeight.w700)),
                      const Text('Printed at the top of every bill. A square PNG or JPG looks best.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        children: [
                          OutlinedButton(onPressed: _logoBusy ? null : () => _logo(app), child: Text(logo == null ? 'Upload logo' : 'Change')),
                          if (logo != null)
                            TextButton(
                              style: TextButton.styleFrom(foregroundColor: Brand.red),
                              onPressed: () => saveSetup(context, (app) => app.ask('/api/salon/logo?organizationId=${app.orgId}', {}, method: 'DELETE'), done: 'Logo removed.'),
                              child: const Text('Remove'),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SectionLabel('Kind of business'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final e in businessTypes.entries)
                ChoiceChip(
                  label: Text(e.value.$1),
                  selected: _type == e.key,
                  onSelected: (_) {
                    setState(() => _type = e.key);
                    saveSetup(context, (app) => app.ask('/api/salon/settings', {'business_type': e.key}, method: 'PATCH'), done: 'Kind of business: ${e.value.$1}.');
                  },
                ),
            ],
          ),
          const SectionLabel('On every bill'),
          TextField(
            controller: _name,
            decoration: InputDecoration(
              labelText: 'Business name',
              errorText: _tried ? textError(_name.text, what: 'the business name', max: 100) : null,
            ),
          ),
          const SizedBox(height: 12),
          PhoneField(value: _phone, label: 'Phone', errorText: _tried ? phoneError(_phone) : null, onChanged: (v) => setState(() => _phone = v)),
          const SizedBox(height: 12),
          TextField(
            controller: _address,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Address', hintText: 'Shop 4, Road No. 12, Banjara Hills, Hyderabad 500034'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _gst,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(labelText: 'GSTIN (leave empty if not registered)', errorText: _gstErr),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(labelText: 'Email', errorText: _tried ? emailError(_email.text) : null),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _prefix,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: 'Bill number starts with',
              helperText: 'Bills look like ${_prefix.text.trim().isEmpty ? 'INV' : _prefix.text.trim().toUpperCase()}-0001',
              errorText: _prefixErr,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(labelText: 'Note at the bottom of bills', hintText: 'Thank you! See you again soon.'),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _includeTax,
            activeThumbColor: Colors.white,
            activeTrackColor: Brand.blue,
            onChanged: (v) => setState(() => _includeTax = v),
            title: const Text('Prices include GST', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: const Text('On: ₹590 means ₹500 + ₹90 GST. Off: GST is added on top.'),
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
          child: FilledButton(
            onPressed: () async {
              setState(() => _tried = true);
              if (textError(_name.text, what: 'the business name', max: 100) != null || phoneError(_phone) != null || _gstErr != null || emailError(_email.text) != null || _prefixErr != null) return;
              final ok = await saveSetup(
                context,
                (app) => app.ask('/api/salon/settings', {
                  ...settingsOf(app),
                  'business_name': _name.text.trim(),
                  'phone': _phone,
                  'address': _address.text.trim(),
                  'gstin': _gst.text.trim().toUpperCase(),
                  'email': _email.text.trim(),
                  'invoice_prefix': _prefix.text.trim().toUpperCase(),
                  'invoice_note': _note.text.trim(),
                  'prices_include_tax': _includeTax,
                }, method: 'PUT'),
                done: 'Saved. New bills use these details.',
              );
              if (ok && context.mounted) Navigator.pop(context);
            },
            child: const Text('Save details'),
          ),
        ),
      ),
    );
  }
}

// ── WhatsApp ──

class WhatsAppSetup extends StatefulWidget {
  const WhatsAppSetup({super.key});
  @override
  State<WhatsAppSetup> createState() => _WhatsAppSetupState();
}

class _WhatsAppSetupState extends State<WhatsAppSetup> {
  late final Map<String, dynamic> s = settingsOf(AppScope.read(context));
  late bool _assistant = s['chat_assistant'] != false;
  late bool _auto = s['auto_approve_bookings'] == true;
  late String _opens = '${s['opens_at'] ?? '10:00'}';
  late String _closes = '${s['closes_at'] ?? '21:00'}';
  late final Set<int> _closed = {for (final d in (s['closed_weekdays'] as List? ?? const [])) (d as num).toInt()};
  late bool _reminders = s['reminders_enabled'] != false;
  late bool _feedback = s['feedback_enabled'] != false;
  late int _delay = (s['feedback_delay_minutes'] as num?)?.toInt() ?? 120;
  late final _review = TextEditingController(text: s['review_link'] ?? '');
  bool _tried = false;

  String _label(String t) {
    final p = t.split(':').map(int.parse).toList();
    return '${p[0] % 12 == 0 ? 12 : p[0] % 12}:${p[1].toString().padLeft(2, '0')} ${p[0] < 12 ? 'am' : 'pm'}';
  }

  Future<void> _pickTime(bool opens) async {
    final p = (opens ? _opens : _closes).split(':').map(int.parse).toList();
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: p[0], minute: p[1]),
    );
    if (t == null) return;
    final v = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    setState(() => opens ? _opens = v : _closes = v);
  }

  String? get _hoursErr => _closes.compareTo(_opens) <= 0
      ? 'Closing time must be after opening time.'
      : _closed.length == 7
      ? 'You cannot be closed every day.'
      : null;
  String? get _reviewErr => _tried && _review.text.trim().isNotEmpty && !RegExp(r'^https://\S+$').hasMatch(_review.text.trim()) ? 'The review link must start with https://' : null;

  @override
  Widget build(BuildContext context) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    Widget toggle(String title, String sub, bool value, ValueChanged<bool> on) => SwitchListTile(
      value: value,
      activeThumbColor: Colors.white,
      activeTrackColor: Brand.blue,
      onChanged: on,
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(sub),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('WhatsApp')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Column(
              children: [
                toggle('WhatsApp assistant', 'Answers questions about services, prices and timings, and books visits, from your menu.', _assistant, (v) => setState(() => _assistant = v)),
                const Divider(),
                toggle('Accept bookings on their own', 'On: a free time a customer picks is booked at once. Off: you accept each on the Front Desk.', _auto, (v) => setState(() => _auto = v)),
              ],
            ),
          ),
          const SectionLabel('Opening hours'),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _pickTime(true),
                  child: FittedBox(fit: BoxFit.scaleDown, child: Text('Opens ${_label(_opens)}')),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _pickTime(false),
                  child: FittedBox(fit: BoxFit.scaleDown, child: Text('Closes ${_label(_closes)}')),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text('Closed on', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [for (var d = 0; d < 7; d++) ChoiceChip(label: Text(days[d]), selected: _closed.contains(d), onSelected: (on) => setState(() => on ? _closed.add(d) : _closed.remove(d)))],
          ),
          if (_hoursErr != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _hoursErr!,
                style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
              ),
            ),
          const SectionLabel('Messages'),
          Card(
            child: Column(
              children: [
                toggle('Reminders', 'About 2 hours before each appointment.', _reminders, (v) => setState(() => _reminders = v)),
                const Divider(),
                toggle('Ask for feedback', 'After the bill, a link to rate the visit and the team.', _feedback, (v) => setState(() => _feedback = v)),
                if (_feedback)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        const Text(
                          'Send it',
                          style: TextStyle(fontSize: 13, color: Brand.muted, fontWeight: FontWeight.w600),
                        ),
                        for (final (m, l) in [(30, '30 min'), (60, '1 hour'), (120, '2 hours'), (240, '4 hours'), (1440, 'Next day')])
                          ChoiceChip(label: Text(m == 1440 ? 'Next day' : 'After $l'), selected: _delay == m, onSelected: (_) => setState(() => _delay = m)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _review,
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              labelText: 'Google review link (optional)',
              hintText: 'https://g.page/r/…',
              helperText: 'Happy customers (4–5 stars) are asked to review you here.',
              errorText: _reviewErr,
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
          child: FilledButton(
            onPressed: () async {
              setState(() => _tried = true);
              if (_hoursErr != null || _reviewErr != null) return;
              final ok = await saveSetup(
                context,
                (app) => app.ask('/api/salon/settings', {
                  'chat_assistant': _assistant,
                  'auto_approve_bookings': _auto,
                  'opens_at': _opens,
                  'closes_at': _closes,
                  'closed_weekdays': _closed.toList()..sort(),
                  'reminders_enabled': _reminders,
                  'feedback_enabled': _feedback,
                  'feedback_delay_minutes': _delay,
                  'review_link': _review.text.trim(),
                }, method: 'PATCH'),
                done: 'WhatsApp settings saved.',
              );
              if (ok && context.mounted) Navigator.pop(context);
            },
            child: const Text('Save'),
          ),
        ),
      ),
    );
  }
}
