// writeToFirestore.js

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with service account credentials
const serviceAccount = require(path.resolve(__dirname, './config/serviceAccountKey.json'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

// Your data object
const collectionName = 'sampleData'
const data = {
    11: {"channelNumber":1,"micOrDi":"Shure SM58","patchName":"Main Vocals","commentsOrStand":"Short Boom Stand"},
    2: {"channelNumber":2,"micOrDi":"Sennheiser e 604","patchName":"Snare","commentsOrStand":"Tall Boom Stand"},
    3: {"channelNumber":3,"micOrDi":"DPA 4099","patchName":"Kick","commentsOrStand":"Direct Connection"},
    4: {"channelNumber":4,"micOrDi":"Shure Beta 52","patchName":"Bass","commentsOrStand":"Cabinet Mount"},
    5: {"channelNumber":5,"micOrDi":"Neumann KM184","patchName":"Ambient","commentsOrStand":"Ceiling Mount"}
};

// Function to write data to Firestore
async function writeDataToFirestore() {
    try {
        const promises = Object.entries(data).map(([key, value]) => {
            // Write the data object directly without wrapping it in another object
            return firestore.collection(collectionName).doc(key).set(value);
        });

        await Promise.all(promises);
        console.log('All documents successfully written!');
    } catch (error) {
        console.error('Error writing documents: ', error);
    }
}

// Execute the function
writeDataToFirestore();
