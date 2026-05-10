const express = require('express');
const axios = require('axios');
const router = express.Router();

function normalize(str) {
  // Lowercase, remove non-alphanumeric, remove consecutive duplicate letters (fuzzy typo fix)
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(.)\1+/g, '$1');
}

// Helper to translate text using Google Translate API
async function translateText(text, targetLang) {
  try {
    const response = await axios.get(`https://translate.googleapis.com/translate_a/single`, {
      params: { client: 'gtx', sl: 'auto', tl: targetLang, dt: 't', q: text }
    });
    if (response.data && response.data[0]) {
      return response.data[0].map(block => block[0]).join('');
    }
    return text;
  } catch (error) {
    console.error("Translation error:", error.message);
    return text;
  }
}

router.post('/', async (req, res) => {
  let userMessage = req.body.message || '';
  const lang = req.body.lang || 'en-US';
  const isTelugu = lang.startsWith('te');

  // If user is speaking Telugu, translate to English for the routing engine
  if (isTelugu) {
    userMessage = await translateText(userMessage, 'en');
    console.log("Translated Telugu to English:", userMessage);
  }

  const lowerMsg = userMessage.toLowerCase();
  const normMsg = normalize(userMessage);

  // Helper to send reply (translates back to Telugu if needed)
  const sendReply = async (replyObj) => {
    if (isTelugu && replyObj.reply) {
      replyObj.reply = await translateText(replyObj.reply, 'te');
    }
    return res.json(replyObj);
  };

  try {
    // REQUIREMENT: Read VOLEMA_API_KEY from backend/.env
    const apiKey = process.env.VOLEMA_API_KEY;
    const apiUrl = process.env.VOLEMA_API_URL;
    
    // REQUIREMENT: Send the user's message to the AI API with the specific System Prompt
    if (apiKey && apiUrl && !apiUrl.includes('placeholder')) {
      console.log("Attempting to reach external Volema AI API...");
      try {
        const aiResponse = await axios.post(apiUrl, {
          messages: [
            { role: "system", content: "You are an AI Smart Campus Navigator. Help users find directions inside the campus." },
            { role: "user", content: userMessage }
          ]
        }, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        // Return exactly what the AI says if the API is configured
        if (aiResponse.data && aiResponse.data.reply) {
          return sendReply({ reply: aiResponse.data.reply });
        }
      } catch (apiError) {
        console.warn("Volema AI API failed or missing. Falling back to Local Map Engine.", apiError.message);
      }
    }

    // --- LOCAL ROUTING ENGINE FALLBACK ---
    // This perfectly syncs with the Map path, distance, and time (Requirement 6 & existing map logic)
    
    // 1. Fetch buildings list from local API
    const PORT = process.env.PORT || 5000;
    const bReq = await fetch(`http://localhost:${PORT}/api/routes/buildings`);
    const bData = await bReq.json();
    const buildings = bData.buildings || [];

    // 2. Find all buildings mentioned (fuzzy match)
    let mentioned = [];
    let tempNormMsg = normMsg;

    // PASS 1: Exact Full Name Match (Longest First)
    // Prevents partial matches from firing if the user explicitly typed the full name.
    const sortedDesc = [...buildings].sort((a, b) => b.name.length - a.name.length);
    for (const b of sortedDesc) {
      const normFull = normalize(b.name);
      if (normFull.length > 2 && tempNormMsg.includes(normFull)) {
        b.matchedNormBase = normFull;
        mentioned.push(b);
        tempNormMsg = tempNormMsg.replace(normFull, '');
        b.alreadyMatched = true;
      }
    }

    // PASS 2: Partial Base Name Match (Shortest First)
    // E.g. User types "billgates", we match "BillGates bhavan".
    // We sort shortest first so that "Technical Hub" (parent) matches before "Technical Hub Garden" (child) if they both strip to "technical".
    const sortedAsc = [...buildings].sort((a, b) => a.name.length - b.name.length);
    for (const b of sortedAsc) {
      if (b.alreadyMatched) continue;

      let baseName = b.name.toLowerCase().replace(/(bhavan|college|block|canteen|ground|hostel|hub|temple|mosque|church|garden|project|model)/g, '').trim();
      if (baseName.length < 3) baseName = b.name;

      const normBase = normalize(baseName);
      if (normBase.length > 2 && tempNormMsg.includes(normBase)) {
        b.matchedNormBase = normBase;
        mentioned.push(b);
        tempNormMsg = tempNormMsg.replace(normBase, '');
        b.alreadyMatched = true;
      }
    }

    // 3. If exactly two buildings are found, it's a routing query!
    if (mentioned.length === 2) {
      let source = mentioned[0].name;
      let dest = mentioned[1].name;

      // Guess which is source and destination based on position of 'from' and 'to'
      const fromIdx = normMsg.indexOf('from');
      const toIdx = normMsg.indexOf('to');
      
      const idx0 = normMsg.indexOf(mentioned[0].matchedNormBase);
      const idx1 = normMsg.indexOf(mentioned[1].matchedNormBase);

      if (fromIdx !== -1) {
         // The building mentioned closest AFTER 'from' is the source
         if (idx0 > fromIdx && (idx1 < fromIdx || idx0 < idx1)) {
            source = mentioned[0].name;
            dest = mentioned[1].name;
         } else if (idx1 > fromIdx) {
            source = mentioned[1].name;
            dest = mentioned[0].name;
         }
      } else if (toIdx !== -1) {
         // The building mentioned closest AFTER 'to' is the destination
         if (idx0 > toIdx && (idx1 < toIdx || idx0 < idx1)) {
            dest = mentioned[0].name;
            source = mentioned[1].name;
         } else if (idx1 > toIdx) {
            dest = mentioned[1].name;
            source = mentioned[0].name;
         }
      } else {
         // Default pattern: "where is [dest] [source]" -> dest comes first
         if (idx0 < idx1) {
           dest = mentioned[0].name;
           source = mentioned[1].name;
         } else {
           dest = mentioned[1].name;
           source = mentioned[0].name;
         }
      }

      // We do not calculate the distance/time in the backend because the frontend MapPage 
      // applies real-time crowd penalties, blocked paths, and a custom discouraging algorithm.
      // To ensure perfect synchronization, we defer the exact numbers to the Map.
      return sendReply({ 
        reply: `I found the best route from **${source}** to **${dest}**! Since crowd levels and blocked paths can change, click the button below to see the optimal live path, exact distance, and estimated time directly on the map.`,
        routeFound: true,
        source: source,
        destination: dest
      });
    }

    // 4. Default simple rules if no exact route found
    if (lowerMsg.includes('library')) {
      return sendReply({ reply: "The Central Library is located in the North Wing, right next to the Science Block. It's open from 8 AM to 10 PM." });
    }
    if (lowerMsg.includes('cafeteria') || lowerMsg.includes('food') || lowerMsg.includes('eat')) {
      return sendReply({ reply: "There are two main cafeterias: The Student Union food court (Central Square) and the Engineering Cafe (East Wing)." });
    }
    if (lowerMsg.includes('admin') || lowerMsg.includes('office')) {
      return sendReply({ reply: "The Main Administrative Office is in Building A, near the main entrance. You can go there for admissions and fee payments." });
    }
    if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
      return sendReply({ reply: "Hello there! Welcome to the Campus Navigator. I can help you find routes. Try asking: 'Where is the Main Gate from the Library?'" });
    }
    
    return sendReply({ reply: "I am best at finding routes! Please try asking something like: 'Where is Bill Gates Bhavan from Main Gate?'" });

  } catch (err) {
    console.error(err);
    res.json({ reply: "Oops, I encountered an internal error trying to process your request." });
  }
});

module.exports = router;
