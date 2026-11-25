import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../auth/auth_parts.dart';

/// More → Delete my account (Google Play asks every app that makes accounts for this). Sends a request to the team,
/// who check it came from the person and then delete the data (app/api/auth/delete-account). Owners and admins
/// delete the whole workspace; staff only their own login. The same steps are on the website at /delete-account.
class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});
  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _reason = TextEditingController();
  bool? _wholeWorkspace;
  String? _scope;
  bool _understood = false;
  bool _busy = false;
  String? _error;
  String? _done;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final data = await app.backend.get('/api/auth/delete-account');
      if (!mounted) return;
      setState(() {
        _wholeWorkspace = data['wholeWorkspace'] == true;
        _scope = '${data['scope'] ?? ''}';
      });
    } catch (_) {
      // Offline or an older server: say it from the person's role
      if (mounted) setState(() => _wholeWorkspace = app.can('settings'));
    }
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await AppScope.read(context).ask('/api/auth/delete-account', {if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim()});
      if (mounted) setState(() => _done = '${data['message'] ?? 'Request sent. We emailed you a copy.'}');
    } catch (e) {
      if (mounted) setState(() => _error = friendlyAuthError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Delete my account')),
      body: SafeArea(
        top: false,
        child: _done != null ? _sent() : _form(),
      ),
    );
  }

  Widget _form() {
    final whole = _wholeWorkspace ?? AppScope.read(context).can('settings');
    final scope = (_scope?.isNotEmpty ?? false)
        ? _scope!
        : whole
        ? 'your login and your whole workspace: customers, chats, bookings, bills, orders, products and settings, for everyone on your team'
        : 'your login. Your workspace and its data stay for the rest of your team';
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFF5D0D0))),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.warning_amber_rounded, color: Brand.red),
              const SizedBox(width: 10),
              Expanded(
                child: Text('We will delete $scope. This cannot be undone.', style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600, height: 1.4)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const Text('What happens next', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.text)),
        const SizedBox(height: 8),
        _step(Icons.mark_email_read_outlined, 'We email you a copy of your request.'),
        _step(Icons.verified_user_outlined, 'Our team checks it came from you, then deletes it and emails you when it is done.'),
        _step(Icons.receipt_long_outlined, 'Some records, like bills and payments, may be kept for as long as the law requires.'),
        if (whole) _step(Icons.credit_card_outlined, 'Paying for a plan? Cancel it in More, then Billing, so you are not charged again.'),
        const SizedBox(height: 16),
        TextField(
          controller: _reason,
          maxLines: 3,
          maxLength: 500,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(labelText: 'Why are you leaving? (optional)', alignLabelWithHint: true),
        ),
        const SizedBox(height: 4),
        CheckboxListTile(
          value: _understood,
          onChanged: _busy ? null : (v) => setState(() => _understood = v ?? false),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          activeColor: Brand.red,
          title: const Text('I understand my data will be deleted', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        ),
        if (_error != null) ...[const SizedBox(height: 8), AuthError(_error!)],
        const SizedBox(height: 14),
        FilledButton(
          onPressed: !_understood || _busy ? null : _send,
          style: FilledButton.styleFrom(backgroundColor: Brand.red, minimumSize: const Size.fromHeight(52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
          child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white)) : const Text('Send request'),
        ),
        const SizedBox(height: 10),
        TextButton(onPressed: _busy ? null : () => Navigator.maybePop(context), child: const Text('Keep my account')),
      ],
    );
  }

  Widget _step(IconData icon, String text) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: Brand.textSoft),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: const TextStyle(height: 1.4, color: Brand.textSoft))),
      ],
    ),
  );

  Widget _sent() => ListView(
    padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
    children: [
      Center(
        child: Container(
          width: 72,
          height: 72,
          decoration: const BoxDecoration(color: Brand.blueSoft, shape: BoxShape.circle),
          child: const Icon(Icons.check, size: 38, color: Brand.blue),
        ),
      ),
      const SizedBox(height: 18),
      const Text('Request sent', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Brand.navy)),
      const SizedBox(height: 8),
      Text(_done!, textAlign: TextAlign.center, style: const TextStyle(color: Brand.textSoft, height: 1.45)),
      const SizedBox(height: 24),
      FilledButton(
        onPressed: () async {
          final app = AppScope.read(context);
          Navigator.of(context).popUntil((route) => route.isFirst);
          await app.signOut();
        },
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        child: const Text('Sign out'),
      ),
      const SizedBox(height: 10),
      OutlinedButton(onPressed: () => Navigator.maybePop(context), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)), child: const Text('Done')),
    ],
  );
}
