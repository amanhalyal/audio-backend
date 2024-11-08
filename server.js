// server.js
//hhhiii
const express = require('express');
const WebSocket = require('ws');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const cors = require('cors');

// Store the latest data for each channel
let channelDataStore = {};

// Initialize Express app
const app = express();
app.use(cors());

// Start HTTP server
const server = app.listen(8080, () => {
  console.log('Server is running on port 8080');
});

// Initialize WebSocket server on top of the HTTP server
const wss = new WebSocket.Server({ server });

// Store connected WebSocket clients
let clients = [];

// When a WebSocket client connects
wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.push(ws);

  // Send the current state to the new client
  ws.send(JSON.stringify({ type: 'initialData', data: channelDataStore }));

  ws.on('close', () => {
    clients = clients.filter((client) => client !== ws);
  });
});

// Function to initialize serial port communication
function initializeSerialPort(portPath) {
  try {
    const serialPort = new SerialPort({
      path: portPath,
      baudRate: 115200,
    });

    serialPort.on('open', () => {
      console.log(`Serial port ${portPath} opened`);
    });

    serialPort.on('error', (err) => {
      console.error('Serial port error:', err);
    });

    const parser = new ReadlineParser({ delimiter: '\n' });
    serialPort.pipe(parser);

    parser.on('data', (data) => {
      console.log(`Received raw data from Arduino: "${data}"`);
      const parsedData = parseArduinoData(data);
      console.log(`Parsed data: ${JSON.stringify(parsedData)}`);

      if (parsedData) {
        // Update the channel data store
        channelDataStore[parsedData.channelNumber] = parsedData;

        // Broadcast to all connected WebSocket clients
        clients.forEach((client) => {
          client.send(JSON.stringify({ type: 'update', data: parsedData }));
        });
      }
    });
  } catch (error) {
    console.error('Error initializing serial port:', error);
  }
}

// Helper function to parse the Arduino data
function parseArduinoData(data) {
  // Example: $$1$Ch1$On$FOH## -> { channelNumber: 1, name: "Ch1", status: "On", attention: "FOH" }
  const match = data.match(/\$\$(\d+)\$Ch(\d+)\$(On|Off)\$(FOH|MOH)\#\#/);
  if (!match) return null;

  return {
    channelNumber: parseInt(match[1], 10),
    name: `Ch${match[2]}`,
    status: match[3],
    attention: match[4],
  };
}

// List available serial ports and select the Arduino port
SerialPort.list()
  .then((ports) => {
    console.log('Available Ports:', ports);
    // Replace this with your Arduino's specific vendorId or productId if necessary
    const arduinoPort = ports.find((port) =>
      port.path.includes('ttyUSB0') || port.path.includes('ttyACM0')
    );
    if (arduinoPort) {
      initializeSerialPort(arduinoPort.path);
    } else {
      console.error('Arduino not found on any serial port.');
    }
  })
  .catch((err) => {
    console.error('Error listing ports:', err);
  });
