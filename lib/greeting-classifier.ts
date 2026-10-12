/**
 * Result of a classification check.
 */
export interface ClassificationResult {
  isGreeting: boolean;
  category: string;
  suggestedReply: string;
}

/**
 * A zero-cost local greeting/small-talk classifier that avoids calling OpenAI for trivial messages.
 * 
 * @param message The input string message from the user
 * @returns An object indicating if it's a greeting, the matched category, and a suggested reply
 */
export function classifyGreeting(message: string): ClassificationResult {
  // Strip punctuation and emojis, trim and lowercase
  const cleanMsg = message.replace(/[^\w\s]|_/g, '').replace(/\s+/g, ' ').toLowerCase().trim();

  const greetings = [
    'hi', 'hello', 'hey', 'hii', 'hiii', 'helo', 'hola', 'good morning', 
    'good afternoon', 'good evening', 'good night', 'morning', 'evening', 
    'assalamu alaikum', 'namaste', 'howdy'
  ];
  
  const thanks = [
    'thanks', 'thank you', 'thankyou', 'thank u', 'thx', 'ty', 
    'thnks', 'thnx', 'appreciated', 'much appreciated'
  ];
  
  const acknowledgments = [
    'ok', 'okay', 'okk', 'okkk', 'k', 'fine', 'sure', 'alright', 
    'noted', 'got it', 'understood', 'cool', 'great', 'awesome', 
    'perfect', 'nice', 'good', 'wonderful', 'excellent'
  ];
  
  const farewells = [
    'bye', 'goodbye', 'good bye', 'see you', 'see ya', 'take care', 'good night', 'gn'
  ];
  
  const smallTalk = [
    'how are you', 'how r u', 'whats up', 'wassup', 'sup', 
    'hows it going', 'how do you do'
  ];

  if (greetings.includes(cleanMsg)) {
    return { isGreeting: true, category: 'greeting', suggestedReply: 'Hello! 👋 How can I help you today?' };
  }
  
  if (thanks.includes(cleanMsg)) {
    return { isGreeting: true, category: 'thanks', suggestedReply: 'You\'re welcome! Is there anything else I can help with?' };
  }
  
  if (acknowledgments.includes(cleanMsg)) {
    return { isGreeting: true, category: 'acknowledgment', suggestedReply: 'Great! Let me know if you need anything else.' };
  }
  
  if (farewells.includes(cleanMsg)) {
    return { isGreeting: true, category: 'farewell', suggestedReply: 'Goodbye! Have a wonderful day! 😊' };
  }
  
  if (smallTalk.includes(cleanMsg)) {
    return { isGreeting: true, category: 'small_talk', suggestedReply: 'I\'m doing great, thank you! How can I assist you?' };
  }

  return { isGreeting: false, category: 'none', suggestedReply: '' };
}
