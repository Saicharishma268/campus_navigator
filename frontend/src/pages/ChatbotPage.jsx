import { useState, useRef, useEffect } from 'react';

// Static UI strings that never touch the backend, so they need their own
// translations rather than relying on chat.js's translateText(). Only the
// greeting + quick-reply chips need this — everything else in the chat
// (the bot's actual replies) already comes back translated from the server.
const GREETING = {
  'en-US': 'Hello! I am your Campus Navigator assistant. How can I help you find your way today?',
  'te-IN': 'హలో! నేను మీ క్యాంపస్ నావిగేటర్ సహాయకుడిని. ఈ రోజు మీకు దారి కనుక్కోవడంలో ఎలా సహాయపడగలను?',
};

const QUICK_PROMPTS = {
  'en-US': ['Find the library', 'Route to canteen', 'Where is the admin block?'],
  'te-IN': ['గ్రంథాలయాన్ని కనుగొనండి', 'క్యాంటీన్‌కు మార్గం', 'అడ్మిన్ బ్లాక్ ఎక్కడ ఉంది?'],
};

function ChatbotPage() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: GREETING['en-US'],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lang, setLang] = useState('en-US');

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const isManualStopRef = useRef(false);

  const activeTranscriptRef = useRef('');
  const langRef = useRef(lang);

  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => {
    // Only swap the greeting's language if it's still the only message —
    // once a real conversation has started we don't want to rewrite history.
    setMessages(prev =>
      prev.length === 1 && prev[0].id === 1
        ? [{ ...prev[0], text: GREETING[lang] || GREETING['en-US'] }]
        : prev,
    );
  }, [lang]);
  useEffect(() => { scrollToBottom(); }, [messages]);
  useEffect(() => {
    return () => {
      isManualStopRef.current = true;
      recognitionRef.current?.stop();
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const startRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || isManualStopRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langRef.current;
    recognition.maxAlternatives = 1;

    let sessionFinalText = '';

    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return;
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      if (isManualStopRef.current || recognitionRef.current !== recognition) return; 

      let interim = '';
      let newFinals = '';
      
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) newFinals += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      
      sessionFinalText += newFinals;
      setInputMessage(activeTranscriptRef.current + sessionFinalText + interim);
    };

    recognition.onerror = (event) => {
      if (isManualStopRef.current || recognitionRef.current !== recognition) return;
      console.error('Speech error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        isManualStopRef.current = true;
        setIsListening(false);
        alert('Microphone access denied. Please allow microphone in browser settings.');
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return; // Prevent old dying instances from auto-restarting

      if (isManualStopRef.current) {
        setIsListening(false);
        return; 
      }

      if (sessionFinalText) {
        activeTranscriptRef.current += sessionFinalText + ' ';
      }
      setTimeout(() => startRecognition(), 100);
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Recognition start error:', err);
      setIsListening(false);
    }
  };

  const toggleListening = async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition not supported. Please use Chrome or Edge.');
      return;
    }

    if (isListening) {
      isManualStopRef.current = true;
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    isManualStopRef.current = false;
    activeTranscriptRef.current = inputMessage ? inputMessage + ' ' : '';
    startRecognition();
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    // Guard against a second send firing while one is still in flight.
    // The submit *button* is visually disabled during isTyping, but pressing
    // Enter inside the text field submits the form directly and bypasses
    // that disabled attribute — so without this check, two overlapping
    // fetch() calls could go out, and whichever server response happens to
    // come back first gets appended first, regardless of send order. That's
    // what causes replies to look "out of sync" with what was asked.
    if (isTyping) return;

    if (isListening) {
      isManualStopRef.current = true;
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    activeTranscriptRef.current = '';

    const userText = inputMessage;
    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
    setInputMessage('');
    setIsTyping(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Volema-Key-1': 'ed868150961e4a7baad387e5a98a1353.gb_96dffkQNtPKkUClzhQWaj',
          'X-Volema-Key-2': 'bb9531a1b2454a059ccd266fc17dfb44.ZWZQnsScq_dAFXXZgVDN1jKw',
        },
        body: JSON.stringify({ message: userText, lang }),
      });

      if (!response.ok) throw new Error('Network error');
      const data = await response.json();

      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        sender: 'bot',
        text: data.reply || "I didn't quite catch that. Could you ask again?",
        routeAction: data.routeFound ? { source: data.source, dest: data.destination } : null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } catch (error) {
      console.error('Fetch error:', error);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        sender: 'bot',
        text: "Sorry, I'm having trouble connecting to the server. Is the backend running?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const quickPrompts = QUICK_PROMPTS[lang] || QUICK_PROMPTS['en-US'];

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">

      {/* Header */}
      <div className="relative flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-white/5 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-900/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-800"></span>
            </span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white leading-tight">Campus Guide AI</h2>
            <p className="text-xs text-emerald-400 font-medium">Online · Ready to help</p>
          </div>
        </div>

        <button
          onClick={() => setLang(lang === 'en-US' ? 'te-IN' : 'en-US')}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-white/15"
        >
          <span className="text-sm">{lang === 'en-US' ? '🇺🇸' : '🇮🇳'}</span>
          {lang === 'en-US' ? 'English' : 'తెలుగు'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 scroll-smooth">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex items-end gap-2.5 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {msg.sender === 'bot' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
            )}

            <div className={`flex flex-col max-w-[72%] ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`relative rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-md ${
                msg.sender === 'user'
                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-br-sm'
                  : 'bg-white/10 text-slate-100 border border-white/10 backdrop-blur-sm rounded-bl-sm'
              }`}>
                {msg.text}
                {msg.routeAction && (
                  <button
                    onClick={() => window.location.href = `/map?source=${encodeURIComponent(msg.routeAction.source)}&destination=${encodeURIComponent(msg.routeAction.dest)}`}
                    className="mt-3 flex items-center gap-2 rounded-xl border border-blue-300/30 bg-white/15 px-3 py-2 text-xs font-bold text-white shadow backdrop-blur transition hover:bg-white/25"
                  >
                    <span>🗺️</span> Show Route on Map
                  </button>
                )}
              </div>
              <span className="mt-1 text-[10px] text-slate-500 px-1">{msg.timestamp}</span>
            </div>

            {msg.sender === 'user' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-700 border border-white/10 shadow-md">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-300" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="flex items-end gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-white/10 border border-white/10 backdrop-blur-sm px-4 py-3.5 flex gap-1.5 items-center shadow-md">
              <div className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      <div className="flex gap-2 px-4 pb-2 overflow-x-auto shrink-0">
        {quickPrompts.map((p) => (
          <button
            key={p}
            onClick={() => { setInputMessage(p); inputRef.current?.focus(); }}
            className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition shrink-0"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="shrink-0 px-4 pb-5 pt-2 border-t border-white/10 bg-white/5 backdrop-blur-sm">
        <form
          onSubmit={handleSendMessage}
          className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm focus-within:border-blue-500/50 focus-within:bg-white/15 transition-all shadow-lg"
        >
          <button
            type="button"
            onClick={toggleListening}
            title={isListening ? 'Stop listening' : 'Start voice input'}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all ${
              isListening
                ? 'bg-red-500 text-white animate-pulse shadow-md'
                : 'bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white'
            }`}
          >
            {isListening ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 002 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 002 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>

          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={isListening ? '🎙️ Listening…' : 'Ask anything about campus…'}
            className="flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder:text-slate-500 outline-none"
          />

          <button
            type="submit"
            disabled={!inputMessage.trim() || isTyping}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md transition-all hover:from-blue-400 hover:to-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 -translate-y-px translate-x-px" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </form>
      </div>

    </div>
  );
}

export default ChatbotPage;