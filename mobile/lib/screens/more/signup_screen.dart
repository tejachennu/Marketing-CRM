import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/app_state.dart';
import '../../ui/theme.dart';
import '../../ui/validate.dart';

/// Sign up: name, business, email and password, then the 6-digit code we email. The account is
/// made only once the code is right (it proves the email is theirs). Needs the internet.
class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key, this.demoCodeStep = false});

  /// Demo screenshots: open on the code step.
  final bool demoCodeStep;
  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _name = TextEditingController();
  final _business = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  bool _hide = true;
  String? _error;
  int _resendIn = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (widget.demoCodeStep) {
      _name.text = 'Teja';
      _business.text = 'Glow Salon';
      _email.text = 'owner@glowsalon.in';
      _password.text = 'secret12';
      _codeSent = true;
      _startTimer(42);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Map<String, String> get _form => {'fullName': _name.text.trim(), 'companyName': _business.text.trim(), 'email': _email.text.trim().toLowerCase(), 'password': _password.text};

  void _startTimer(int seconds) {
    _timer?.cancel();
    setState(() => _resendIn = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_resendIn <= 1) t.cancel();
      if (mounted) setState(() => _resendIn = (_resendIn - 1).clamp(0, 999));
    });
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await task();
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool _tried = false;
  String? get _nameErr => _tried ? textError(_name.text, what: 'your name', min: 2, max: 80) : null;
  String? get _businessErr => _tried ? textError(_business.text, what: 'your business name', min: 2, max: 80) : null;
  String? get _emailErr => _tried ? emailError(_email.text, required: true) : null;
  String? get _passwordErr => _tried ? passwordError(_password.text) : null;

  Future<void> _sendCode() async {
    setState(() => _tried = true);
    if (!_codeSent && (_nameErr ?? _businessErr ?? _emailErr ?? _passwordErr) != null) return;
    return _sendCodeNow();
  }

  Future<void> _sendCodeNow() => _run(() async {
    final wait = await AppScope.read(context).sendSignupCode(_form);
    setState(() {
      _codeSent = true;
      _code.clear();
    });
    _startTimer(wait);
  });

  Future<void> _create() => _run(() async {
    await AppScope.read(context).createAccount(_form, _code.text.trim());
    if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(_codeSent ? 'Check your email' : 'Create your account')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            if (!_codeSent) ...[
              const Text('Start your 14-day free trial. Every feature included, with ₹300 of free AI credit.', style: TextStyle(color: Brand.textSoft, height: 1.4)),
              const SizedBox(height: 20),
              TextField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                onChanged: (_) => _tried ? setState(() {}) : null,
                decoration: InputDecoration(labelText: 'Your name', prefixIcon: const Icon(Icons.person_outline), errorText: _nameErr),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _business,
                textCapitalization: TextCapitalization.words,
                onChanged: (_) => _tried ? setState(() {}) : null,
                decoration: InputDecoration(labelText: 'Business name', prefixIcon: const Icon(Icons.storefront_outlined), errorText: _businessErr),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                onChanged: (_) => _tried ? setState(() {}) : null,
                decoration: InputDecoration(labelText: 'Email', prefixIcon: const Icon(Icons.mail_outline), errorText: _emailErr),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _password,
                obscureText: _hide,
                onChanged: (_) => _tried ? setState(() {}) : null,
                decoration: InputDecoration(
                  errorText: _passwordErr,
                  labelText: 'Password (6 or more letters)',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(onPressed: () => setState(() => _hide = !_hide), icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined)),
                ),
              ),
            ] else ...[
              Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(16)),
                  child: const Icon(Icons.mark_email_read_outlined, color: Brand.blue, size: 28),
                ),
              ),
              const SizedBox(height: 16),
              Text.rich(
                TextSpan(
                  style: const TextStyle(fontSize: 15, color: Brand.textSoft, height: 1.45),
                  children: [
                    const TextSpan(text: 'We emailed a 6-digit code to '),
                    TextSpan(
                      text: _email.text.trim(),
                      style: const TextStyle(fontWeight: FontWeight.w800, color: Brand.text),
                    ),
                    const TextSpan(text: '. It works for 10 minutes. Check spam if you do not see it.'),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: _code,
                autofocus: true,
                keyboardType: TextInputType.number,
                maxLength: 6,
                textAlign: TextAlign.center,
                autofillHints: const [AutofillHints.oneTimeCode],
                onChanged: (_) => setState(() {}),
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 12),
                decoration: const InputDecoration(counterText: '', hintText: '······'),
              ),
              const SizedBox(height: 8),
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                children: [
                  TextButton(onPressed: _busy ? null : () => setState(() => _codeSent = false), child: const Text('Change details')),
                  TextButton(onPressed: _busy || _resendIn > 0 ? null : _sendCode, child: Text(_resendIn > 0 ? 'Send again in ${_resendIn}s' : 'Send a new code')),
                ],
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12)),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600),
                ),
              ),
            ],
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy || (_codeSent && _code.text.trim().length != 6) ? null : (_codeSent ? _create : _sendCode),
              child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(_codeSent ? 'Create account' : 'Email me a code'),
            ),
            const SizedBox(height: 14),
            if (!_codeSent)
              const Text(
                'We send a code to your email to check it is yours. No code, no account.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12.5, color: Brand.muted),
              ),
          ],
        ),
      ),
    );
  }
}
