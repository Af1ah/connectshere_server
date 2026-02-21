const { db } = require('../config/firebase');
const { doc, getDoc, setDoc, deleteDoc } = require('firebase/firestore');
const { BufferJSON, initAuthCreds } = require('@kelvdra/baileys');

const useFirebaseAuthState = async (userId) => {
    const collectionName = 'whatsapp_creds';
    const userCredsRef = doc(db, 'users', userId, collectionName, 'creds');

    const writeData = async (data, id) => {
        const ref = doc(db, 'users', userId, collectionName, id);
        await setDoc(ref, { value: JSON.stringify(data, BufferJSON.replacer) }, { merge: true });
    };

    const readData = async (id) => {
        try {
            const ref = doc(db, 'users', userId, collectionName, id);
            const snapshot = await getDoc(ref);
            if (snapshot.exists()) {
                const data = snapshot.data();
                return JSON.parse(data.value, BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            const ref = doc(db, 'users', userId, collectionName, id);
            await deleteDoc(ref);
        } catch (error) {
            // ignore
        }
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = BufferJSON.reviver(null, value);
                            }
                            if (value) {
                                data[id] = value;
                            }
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        },
    };
};

module.exports = useFirebaseAuthState;
