/**
 * User Controller
 * Handles user profile and onboarding status
 */

const firebaseService = require('../services/firebaseService');
const knowledgeService = require('../services/knowledgeService');

/**
 * Get user profile (business details)
 */
const getProfile = async (req, res) => {
    try {
        const userId = req.user.uid;
        const profile = await firebaseService.getUserProfile(userId);
        res.json(profile || {});
    } catch (error) {
        console.error('Error getting user profile:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
};

/**
 * Update user profile and add to RAG knowledge base
 */
const updateProfile = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { businessName, businessType, contactEmail, contactPhone, description } = req.body;

        if (!businessName) {
            return res.status(400).json({ error: 'Business name is required' });
        }

        const profileData = {
            businessName,
            businessType: businessType || 'General',
            contactEmail: contactEmail || '',
            contactPhone: contactPhone || '',
            description: description || ''
        };

        // Save profile
        await firebaseService.updateUserProfile(userId, profileData);

        // Add business info to RAG knowledge base
        const businessContext = `
Business Name: ${businessName}
Business Type: ${businessType || 'General'}
${description ? `About: ${description}` : ''}
${contactEmail ? `Email: ${contactEmail}` : ''}
${contactPhone ? `Phone: ${contactPhone}` : ''}
        `.trim();

        await knowledgeService.addKnowledge(
            userId,
            businessContext,
            'business_profile',
            'business'
        );

        res.json({ message: 'Profile saved successfully' });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
};

/**
 * Get onboarding status
 */
const getOnboardingStatus = async (req, res) => {
    try {
        const userId = req.user.uid;
        const status = await firebaseService.getOnboardingStatus(userId);
        res.json(status || { completed: false, currentStep: 0, completedSteps: [] });
    } catch (error) {
        console.error('Error getting onboarding status:', error);
        res.status(500).json({ error: 'Failed to get onboarding status' });
    }
};

/**
 * Update onboarding status
 */
const updateOnboardingStatus = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { currentStep, completedSteps, completed } = req.body;

        await firebaseService.updateOnboardingStatus(userId, {
            currentStep,
            completedSteps,
            completed: completed || false
        });

        res.json({ message: 'Onboarding status updated' });
    } catch (error) {
        console.error('Error updating onboarding status:', error);
        res.status(500).json({ error: 'Failed to update onboarding status' });
    }
};

module.exports = {
    getProfile,
    updateProfile,
    getOnboardingStatus,
    updateOnboardingStatus
};
