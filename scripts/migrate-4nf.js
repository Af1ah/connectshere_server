require('dotenv').config();

const { db } = require('../src/config/firebase');
const {
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteField,
    serverTimestamp
} = require('firebase/firestore');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const migrateUser = async (userId) => {
    let migratedAiFiles = 0;
    let migratedOnboardingSteps = 0;
    let migratedScheduleDays = 0;

    // 1) AI files: settings/ai_config.files[] -> ai_config_files/*
    const aiConfigRef = doc(db, 'users', userId, 'settings', 'ai_config');
    const aiConfigSnap = await getDoc(aiConfigRef);
    if (aiConfigSnap.exists()) {
        const aiConfig = aiConfigSnap.data();
        if (Array.isArray(aiConfig.files) && aiConfig.files.length > 0) {
            for (let i = 0; i < aiConfig.files.length; i++) {
                const file = aiConfig.files[i] || {};
                const fileId = String(file.id || `legacy_file_${i + 1}`);
                await setDoc(doc(db, 'users', userId, 'ai_config_files', fileId), {
                    ...file,
                    migratedFrom: 'settings.ai_config.files',
                    migratedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }, { merge: true });
                migratedAiFiles++;
            }
            await updateDoc(aiConfigRef, { files: deleteField() });
        }
    }

    // 2) Onboarding steps: settings/onboarding.completedSteps[] -> onboarding_steps/*
    const onboardingRef = doc(db, 'users', userId, 'settings', 'onboarding');
    const onboardingSnap = await getDoc(onboardingRef);
    if (onboardingSnap.exists()) {
        const onboarding = onboardingSnap.data();
        if (Array.isArray(onboarding.completedSteps) && onboarding.completedSteps.length > 0) {
            for (const rawStep of onboarding.completedSteps) {
                const stepNo = Number(rawStep);
                if (!Number.isFinite(stepNo)) continue;
                await setDoc(doc(db, 'users', userId, 'onboarding_steps', `step_${stepNo}`), {
                    stepNo,
                    status: 'completed',
                    migratedFrom: 'settings.onboarding.completedSteps',
                    migratedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }, { merge: true });
                migratedOnboardingSteps++;
            }
            await updateDoc(onboardingRef, { completedSteps: deleteField() });
        }
    }

    // 3) Consultant schedule: settings/consultant_config.schedule -> consultant_schedule/*
    const consultantRef = doc(db, 'users', userId, 'settings', 'consultant_config');
    const consultantSnap = await getDoc(consultantRef);
    if (consultantSnap.exists()) {
        const consultant = consultantSnap.data();
        const schedule = consultant.schedule;
        if (schedule && typeof schedule === 'object') {
            for (const day of DAYS) {
                if (!schedule[day]) continue;
                await setDoc(doc(db, 'users', userId, 'consultant_schedule', day), {
                    ...schedule[day],
                    migratedFrom: 'settings.consultant_config.schedule',
                    migratedAt: serverTimestamp()
                }, { merge: true });
                migratedScheduleDays++;
            }
            await updateDoc(consultantRef, { schedule: deleteField() });
        }
    }

    return { migratedAiFiles, migratedOnboardingSteps, migratedScheduleDays };
};

const main = async () => {
    const usersSnapshot = await getDocs(collection(db, 'users'));

    let totalUsers = 0;
    let totalAiFiles = 0;
    let totalOnboardingSteps = 0;
    let totalScheduleDays = 0;

    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        totalUsers++;
        try {
            const result = await migrateUser(userId);
            totalAiFiles += result.migratedAiFiles;
            totalOnboardingSteps += result.migratedOnboardingSteps;
            totalScheduleDays += result.migratedScheduleDays;
            console.log(`[${userId}] files=${result.migratedAiFiles}, steps=${result.migratedOnboardingSteps}, scheduleDays=${result.migratedScheduleDays}`);
        } catch (error) {
            console.error(`[${userId}] migration failed:`, error.message);
        }
    }

    console.log('Migration complete');
    console.log(`users=${totalUsers}`);
    console.log(`ai_config_files migrated=${totalAiFiles}`);
    console.log(`onboarding_steps migrated=${totalOnboardingSteps}`);
    console.log(`consultant_schedule days migrated=${totalScheduleDays}`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
