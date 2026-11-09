import 'screen_check.dart';

/// The campaign screens, and the sheets behind a tap.
void main() {
  screenChecks(
    screens: ['campaigns', 'new_campaign', 'campaign', 'campaign_scheduled', 'campaign_sending', 'choose_people'],
    flows: [
      ('campaign', ['Everyone ·']),
      ('campaign', ['Everyone ·', 'Not sent']),
      ('campaigns', ['Scheduled']),
      ('new_campaign', ['diwali_offer']),
      ('new_campaign', ['diwali_offer', 'Upload a list']),
      ('choose_people', ['Tags']),
      ('choose_people', ['Past campaigns']),
    ],
  );
}
