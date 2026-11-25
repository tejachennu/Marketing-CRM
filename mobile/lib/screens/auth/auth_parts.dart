import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config.dart';
import '../../data/backend.dart';
import '../../ui/theme.dart';

/// Pieces shared by sign-in, sign-up and the welcome pages: the pictures, the Google button, the
/// 6-box code field and a plain error box.

/// One of the drawn pictures in assets/images (welcome, desk, shop, nowa, team, signup, code, offline),
/// kept to its shape and never taller than [maxHeight].
class AuthPicture extends StatelessWidget {
  const AuthPicture(this.name, {super.key, required this.aspect, this.maxHeight = 260, this.semantic});
  final String name;

  /// Width ÷ height of the drawing (welcome 360/250, desk / shop / nowa 360/232, signup 360/176, code 360/150).
  final double aspect;
  final double maxHeight;

  /// Read out by screen readers; null = decoration only.
  final String? semantic;

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxHeight: maxHeight, maxWidth: maxHeight * aspect),
      child: AspectRatio(
        aspectRatio: aspect,
        child: Image.asset(
          'assets/images/$name.png',
          fit: BoxFit.contain,
          semanticLabel: semantic,
          excludeFromSemantics: semantic == null,
          // A missing picture must never break sign-in
          errorBuilder: (_, _, _) => const SizedBox.shrink(),
        ),
      ),
    ),
  );
}

/// "Continue with Google" with Google's own G (their sign-in rules ask for it).
class GoogleButton extends StatelessWidget {
  const GoogleButton({super.key, required this.onPressed, this.busy = false});
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: busy ? null : onPressed,
    style: OutlinedButton.styleFrom(
      minimumSize: const Size.fromHeight(52),
      foregroundColor: Brand.text,
      backgroundColor: Colors.white,
      side: const BorderSide(color: Brand.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        busy
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : Image.asset('assets/images/google_g.png', width: 20, height: 20, errorBuilder: (_, _, _) => const Text('G', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.blue))),
        const SizedBox(width: 12),
        const Flexible(
          child: Text('Continue with Google', overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
        ),
      ],
    ),
  );
}

/// The big green button of each step, with a spinner while it works.
class BigButton extends StatelessWidget {
  const BigButton({super.key, required this.label, required this.onPressed, this.busy = false, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: busy ? null : onPressed,
    style: FilledButton.styleFrom(
      minimumSize: const Size.fromHeight(54),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      disabledBackgroundColor: busy ? Brand.blue : null,
    ),
    child: busy
        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
        : Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Flexible(child: Text(label, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
              if (icon != null) ...[const SizedBox(width: 8), Icon(icon, size: 20)],
            ],
          ),
  );
}

/// What went wrong, in red, with an icon (red is kept for problems only).
class AuthError extends StatelessWidget {
  const AuthError(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
      decoration: BoxDecoration(color: Brand.redSoft, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFF5D0D0))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, color: Brand.red, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: const TextStyle(color: Brand.red, fontWeight: FontWeight.w600, height: 1.35)),
          ),
        ],
      ),
    ),
  );
}

/// Turns what the server or Supabase said into a short sentence a shop owner understands.
String friendlyAuthError(Object error) {
  final text = '$error'.replaceFirst('Exception: ', '').trim();
  final lower = text.toLowerCase();
  // The server's own words are already plain (e.g. "Too many wrong tries. Send a new code."): keep them
  if (error is OfflineException) return text;
  if (lower.contains('socketexception') || lower.contains('failed host lookup') || lower.contains('handshakeexception')) {
    return 'No internet connection. Check your internet and try again.';
  }
  if (lower.contains('invalid login credentials') || lower.contains('invalid email or password')) {
    return 'That email and password do not match. Check them, or reset your password.';
  }
  if (lower.contains('email not confirmed')) return 'Please confirm your email first: open the link we emailed you, then sign in.';
  if (lower.contains('already registered') || lower.contains('already exists') || lower.contains('already been registered')) {
    return 'There is already an account with this email. Sign in instead, or use another email.';
  }
  if (lower.contains('rate limit') || lower.contains('for security purposes')) return 'Too many tries. Please wait a minute and try again.';
  if (text.isEmpty || text.startsWith('{') || text.contains('Instance of') || text.length > 220) {
    return 'Something went wrong. Please try again.';
  }
  return text;
}

/// Opens a page of the website (forgot password, terms, privacy) in the phone's browser.
Future<void> openWebsitePage(BuildContext context, String path) async {
  final ok = await launchUrl(Uri.parse('${AppConfig.apiBase}$path'), mode: LaunchMode.externalApplication).catchError((_) => false);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Open ${AppConfig.apiBase.replaceFirst('https://', '')}$path in your browser.')));
  }
}

/// "By continuing you agree to the Terms and Privacy Policy", both tappable.
class TermsLine extends StatelessWidget {
  const TermsLine({super.key});

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.4);
    Widget link(String label, String path) => InkWell(
      onTap: () => openWebsitePage(context, path),
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
        child: Text(label, style: style.copyWith(color: Brand.textSoft, fontWeight: FontWeight.w600, decoration: TextDecoration.underline, decorationColor: Brand.border)),
      ),
    );
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [const Text('By continuing you agree to the ', style: style), link('Terms', '/terms'), const Text(' and ', style: style), link('Privacy Policy', '/privacy')],
    );
  }
}

/// A 6-digit code as six boxes. One hidden text field takes the typing (and the phone's code
/// suggestion), the boxes show it. Calls [onCompleted] when all six are in.
class CodeBoxes extends StatefulWidget {
  const CodeBoxes({super.key, required this.controller, this.focusNode, this.onChanged, this.onCompleted, this.enabled = true, this.autofocus = true, this.error = false});
  final TextEditingController controller;

  /// Pass one to put the keyboard back after a wrong code.
  final FocusNode? focusNode;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onCompleted;
  final bool enabled;
  final bool autofocus;

  /// Show the boxes in red (the code was wrong).
  final bool error;
  static const length = 6;

  @override
  State<CodeBoxes> createState() => _CodeBoxesState();
}

class _CodeBoxesState extends State<CodeBoxes> {
  FocusNode? _own;
  FocusNode get _focus => widget.focusNode ?? (_own ??= FocusNode());

  @override
  void initState() {
    super.initState();
    _focus.addListener(_redraw);
    widget.controller.addListener(_redraw);
  }

  @override
  void didUpdateWidget(CodeBoxes old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller.removeListener(_redraw);
      widget.controller.addListener(_redraw);
    }
    if (old.focusNode != widget.focusNode) {
      (old.focusNode ?? _own)?.removeListener(_redraw);
      _focus.addListener(_redraw);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_redraw);
    _focus.removeListener(_redraw);
    _own?.dispose();
    super.dispose();
  }

  void _redraw() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final code = widget.controller.text;
    return LayoutBuilder(
      builder: (context, box) {
        const gap = 8.0;
        final side = ((box.maxWidth - gap * (CodeBoxes.length - 1)) / CodeBoxes.length).clamp(36.0, 54.0);
        return Semantics(
          label: 'Six digit code',
          value: code,
          textField: true,
          onTap: widget.enabled ? _focus.requestFocus : null,
          child: SizedBox(
            height: side * 1.18,
            child: Stack(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 0; i < CodeBoxes.length; i++) ...[
                      if (i > 0) const SizedBox(width: gap),
                      _box(i < code.length ? code[i] : '', side, active: _focus.hasFocus && (i == code.length || (i == CodeBoxes.length - 1 && code.length == CodeBoxes.length))),
                    ],
                  ],
                ),
                // The real field, on top and see-through: a tap anywhere opens the number keyboard
                Positioned.fill(
                  child: ExcludeSemantics(
                    child: TextField(
                      controller: widget.controller,
                      focusNode: _focus,
                      enabled: widget.enabled,
                      autofocus: widget.autofocus,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(CodeBoxes.length)],
                      showCursor: false,
                      // Long-press → Paste works (a code copied from the email)
                      enableInteractiveSelection: true,
                      style: const TextStyle(color: Colors.transparent, fontSize: 1),
                      cursorColor: Colors.transparent,
                      decoration: const InputDecoration(
                        filled: false,
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        disabledBorder: InputBorder.none,
                        counterText: '',
                        contentPadding: EdgeInsets.zero,
                      ),
                      onChanged: (v) {
                        widget.onChanged?.call(v);
                        if (v.length == CodeBoxes.length) {
                          // Let the last digit show before moving on
                          Timer(const Duration(milliseconds: 120), () {
                            if (mounted && widget.controller.text.length == CodeBoxes.length) widget.onCompleted?.call(widget.controller.text);
                          });
                        }
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _box(String digit, double side, {required bool active}) {
    final filled = digit.isNotEmpty;
    final edge = widget.error ? Brand.red : (active ? Brand.blue : (filled ? const Color(0xFF7CC5B4) : Brand.border));
    return AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      width: side,
      height: side * 1.18,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: widget.error ? Brand.redSoft : (filled ? Brand.blueSoft : Colors.white),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: edge, width: active || widget.error ? 2 : 1.2),
      ),
      child: Text(digit, style: TextStyle(fontSize: side * 0.46, fontWeight: FontWeight.w700, color: widget.error ? Brand.red : Brand.text)),
    );
  }
}

/// A thin bar showing how far along sign-up is.
class StepBar extends StatelessWidget {
  const StepBar({super.key, required this.step, required this.steps});
  final int step;
  final int steps;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Step ${step + 1} of $steps',
    child: Row(
      children: [
        for (var i = 0; i < steps; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              height: 5,
              decoration: BoxDecoration(color: i <= step ? Brand.blue : Brand.line, borderRadius: BorderRadius.circular(99)),
            ),
          ),
        ],
      ],
    ),
  );
}

/// A soft green pill with an icon: "14 days free", "No card needed"…
class SoftPill extends StatelessWidget {
  const SoftPill({super.key, required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(color: Brand.blueSoft, borderRadius: BorderRadius.circular(99)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: Brand.blue),
        const SizedBox(width: 5),
        Flexible(child: Text(label, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFF15603E)))),
      ],
    ),
  );
}
