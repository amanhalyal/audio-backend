// server.js

// Import necessary modules
const express = require('express');
const WebSocket = require('ws');
const { SerialPort } = require('serialport');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

const collectionName = 'sampleData'

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, 'config', 'serviceAccountKey.json'); // Update the path if necessary

try {
  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log('Firebase Admin initialized successfully.');
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  process.exit(1); // Exit the application if Firebase initialization fails
}

const db = admin.firestore();

// Initialize Express app
const app = express();
app.use(cors());

// Store the latest data for each channel
let channelDataStore = {};
let options = ['success','partial','failure']
// Start HTTP server
const PORT = 8080;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Initialize WebSocket server on top of the HTTP server with specific path
const wss = new WebSocket.Server({ server, path: '/ws' });
console.log('WebSocket server is running and listening for connections');

// Store connected WebSocket clients
let clients = [];

// Handle WebSocket client connections
wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.push(ws);

  // Send the current state to the new client
  ws.send(JSON.stringify({ type: 'initialData', data: channelDataStore }));

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients = clients.filter((client) => client !== ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Function to handle complete messages from Arduino
async function handleCompleteMessage(message) {
  console.log(`Complete message received: "${message}"`);

  const parsedData = parseArduinoData(message);
  if (parsedData) {
    try {
      const docId = parsedData.channelNumber.toString();
      const docRef = db.collection(collectionName).doc(docId);
      const doc = await docRef.get();

      if (!doc.exists) {
        console.error(`No such document with ID: ${docId}`);
        parsedData.matchesFirestore = false;
      } else {
        const dbData = doc.data();
        console.log(`Firestore Data for Channel ${docId}:`, dbData);

        let matches = true;
        let mismatchedFields = [];

        // Compare each field with type coercion and trimming
        ['channelNumber', 'micOrDi', 'patchName', 'commentsOrStand'].forEach((field) => {
          let arduinoValue = parsedData[field];
          let firestoreValue = dbData[field];

          if (field === 'channelNumber') {
            // Ensure both are numbers
            arduinoValue = Number(arduinoValue);
            firestoreValue = Number(firestoreValue);
          } else {
            // Ensure both are trimmed strings
            arduinoValue = typeof arduinoValue === 'string' ? arduinoValue.trim() : arduinoValue;
            firestoreValue = typeof firestoreValue === 'string' ? firestoreValue.trim() : firestoreValue;
          }

          if (arduinoValue !== firestoreValue) {
            matches = false;
            mismatchedFields.push(field);
          }
        });

        parsedData.matchesFirestore = matches;

        // If there are mismatches, print them to the terminal
        if (!matches) {
          console.warn(`Mismatch detected for Channel ${parsedData.channelNumber}:`);
          mismatchedFields.forEach((field) => {
            console.warn(
              ` - Field "${field}" does not match. Arduino: "${parsedData[field]}", Firestore: "${dbData[field]}"`
            );
          });
        }
      }
    } catch (error) {
      console.error('Error accessing Firestore:', error);
      parsedData.matchesFirestore = false;
    }

    // Update the channel data store
    channelDataStore[parsedData.channelNumber] = parsedData;

    // Broadcast to all connected WebSocket clients
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'update', data: parsedData }));
      }
    });
  } else {
    console.error(`Failed to parse data: "${message}"`);
  }
}

// Helper function to parse the Arduino data
function parseArduinoData(data) {
  // Example message: "$$1$Shure SM58$Main Vocals$Short Boom Stand##"
  data = data.trim();
  const parts = data.split('$');

  // Expected parts: ["", "", "1", "Shure SM58", "Main Vocals", "Short Boom Stand##"]
  // After splitting by '$', parts[0] and parts[1] should be empty strings
  if (parts.length < 6 || parts[0] !== '' || parts[1] !== '') {
    console.error(`Invalid data format: "${data}"`);
    return null;
  }

  // Remove any trailing delimiters like '##' from the last part
  const commentsOrStand = parts[5].replace(/##$/, '').trim();

  const channelNumber = parseInt(parts[2], 10);
  if (isNaN(channelNumber)) {
    console.error(`Invalid channel number: "${parts[2]}"`);
    return null;
  }

  const micOrDi = parts[3].trim();
  const patchName = parts[4].trim();

  const obj = {
    channelNumber,
    micOrDi,
    patchName,
    commentsOrStand,
  };
  console.log(`Parsed JSON Data: ${JSON.stringify(obj)}\n`);
  return obj;
}

// Function to initialize serial port communication
function initializeSerialPort(portPath) {
  const serialPort = new SerialPort({
    path: portPath,
    baudRate: 115200,
    autoOpen: false, // Control when to open
  });

  // Function to attempt opening the serial port
  const openSerialPort = () => {
    serialPort.open((err) => {
      if (err) {
        console.error(`Error opening serial port ${portPath}:`, err.message);
        // Retry after a delay if opening fails
        setTimeout(openSerialPort, 5000);
      }
    });
  };

  // Open the serial port
  openSerialPort();

  serialPort.on('open', () => {
    console.log(`Serial port ${portPath} opened`);
  });

  serialPort.on('close', () => {
    console.log(`Serial port ${portPath} closed. Attempting to reconnect...`);
    openSerialPort();
  });

  serialPort.on('error', (err) => {
    console.error(`Serial port ${portPath} error:`, err);
  });

  // Initialize buffer for accumulating incoming data
  let buffer = '';

  // Listen to incoming data
  serialPort.on('data', (data) => {
    const dataStr = data.toString();
    console.log(`Data received from serial port (raw): "${dataStr.trim()}"`);

    buffer += dataStr; // Append incoming data to buffer

    let delimiterIndex;
    // Process all complete messages in the buffer
    while ((delimiterIndex = buffer.indexOf('##')) !== -1) {
      // Extract the complete message
      const completeMessage = buffer.slice(0, delimiterIndex);
      // Remove the processed message and delimiter from the buffer
      buffer = buffer.slice(delimiterIndex + 2);

      // Process the complete message
      handleCompleteMessage(completeMessage.trim());
    }
  });
}

// Function to list available serial ports and select the Arduino port
async function listAndInitializeSerialPort() {
  try {
    const ports = await SerialPort.list();
    console.log('Available Serial Ports:');
    ports.forEach((port) => {
      console.log(
        `- Path: ${port.path}, Manufacturer: ${port.manufacturer || 'N/A'}, Vendor ID: ${port.vendorId || 'N/A'}, Product ID: ${port.productId || 'N/A'}`
      );
    });

    // Adjust the criteria to match your Arduino's identifiers
    const arduinoPort = ports.find(
      (port) =>
        port.manufacturer &&
        (port.manufacturer.includes('Arduino') ||
          port.manufacturer.includes('wch.cn') ||
          port.vendorId === '1a86')
    );

    if (arduinoPort) {
      console.log(`Arduino found on port ${arduinoPort.path}`);
      initializeSerialPort(arduinoPort.path);
    } else {
      console.error('Arduino not found on any serial port.');
      // Optionally, you can retry searching for the Arduino after some time
      // setTimeout(listAndInitializeSerialPort, 5000);
    }
  } catch (err) {
    console.error('Error listing serial ports:', err);
  }
}

// Start the process of listing and initializing the serial port
listAndInitializeSerialPort();

/**
 * Optional: Test Firestore Access
 * This function fetches a test document to verify Firestore integration.
 * Uncomment and call this function if you need to test Firestore access separately.
 */
/*
async function testFirestore() {
  const testDocId = '1'; // Replace with an existing document ID
  const docRef = db.collection('sampleData').doc(testDocId);
  try {
    const doc = await docRef.get();
    if (doc.exists) {
      console.log(`Test Firestore Document Data for ID ${testDocId}:`, doc.data());
    } else {
      console.log(`No such document with ID: ${testDocId}`);
    }
  } catch (error) {
    console.error('Error fetching test document:', error);
  }
}

// Call the test function after Firestore initialization
// testFirestore();
*/

