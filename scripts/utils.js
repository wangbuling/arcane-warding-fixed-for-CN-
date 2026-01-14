import { SOCKET_NAME, handleSendMessageRequest } from './socket.js';

/**
 * Send a message to the chat
 * 
 * @param {string} message - The message to send
 * @param {Actor} actor - The actor to send the message
 * @param {string} mode - The mode to send the message
 * @param {boolean} useBubble - Whether to use a bubble for the message
 */
function sendMessage(message, actor, mode = "publicroll", useBubble = false) {
    const speaker = ChatMessage.getSpeaker({ actor: actor });
    const chatData = {
        user: game.user.id,
        content: message,
        speaker: speaker,
        sound: CONFIG.defaultChatSound
    };

    if (mode === 'emote') {
        chatData.type = CONST.CHAT_MESSAGE_TYPES.EMOTE;
    } else {
        ChatMessage.applyRollMode(chatData, mode);
    }

    const payload = {
        chatData: chatData,
        useBubble: useBubble,
        actorId: actor.id
    };

    if (game.user.isGM) {
        // If user is GM, handle message creation directly
        handleSendMessageRequest(payload);
    } else {
        // If user is not GM, emit to GM to handle
        game.socket.emit(SOCKET_NAME, {
            type: 'sendMessage',
            payload: payload
        });
    }
}

/**
 * Check if an actor is an Abjurer wizard
 * 
 * @param {Actor} actor - The actor to check
 * @returns {boolean} - True if the actor is an Abjurer wizard, false otherwise
 */
function isAbjurerWizard(actor, ABJURER_SUBCLASS) {
	if (!actor || !actor.classes) return false;
	
	const subclass = actor.items.find(item =>  {
		return item.type === "subclass" && ABJURER_SUBCLASS.includes(item.name);
	});

	return subclass !== undefined ? true : false;
}

/**
 * Get current Arcane Ward data
 * 
 * @param {Actor} actor - The actor to check
 * @returns {Item} - The Arcane Ward item
 */
function getArcaneWard(actor) {
	if(hasArcaneWard(actor)) {
		return actor.items.find(item => item.type === 'feat' && (item.name.includes('Arcane Ward') || item.name.includes('奥术守御')));
	}
	return null;
}

/**
 * Check if the actor has the Arcane Ward feature
 * 
 * @param {Actor} actor - The actor to check
 * @returns {boolean} - True if the actor has an Arcane Ward, false otherwise
 */
function hasArcaneWard(actor) {
	return actor.items.find(item => item.type === 'feat' && (item.name.includes('Arcane Ward') || item.name.includes('奥术守御'))) ? true : false;
}

/**
 * Get the Arcane Ward effect
 * 
 * @param {Item or Actor} item - The item or actor to check
 * @returns {ActiveEffect} - The Arcane Ward effect
 */
function getArcaneWardEffect(item) {
    // 这里其实可以简化，不用再调 has... 函数了，直接找，找到了就是有，没找到就是 null
    const effectName = game.i18n.localize('ARCANE_WARDING.EFFECT_NAME'); 
    return item.effects.find(effect => effect.name === "Arcane Ward" || effect.name === effectName) || null;
}

/**
 * Check if the actor has the Arcane Ward effect
 * 
 * @param {Actor or Item} item - The actor or item to check
 * @returns {boolean} - True if the actor has an Arcane Ward effect, false otherwise
 */
function hasArcaneWardEffect(item) {
    const effectName = game.i18n.localize('ARCANE_WARDING.EFFECT_NAME');
    return item.effects.find(effect => effect.name === "Arcane Ward" || effect.name === effectName) ? true : false;
}

/**
 * Get all actors with the Projected Ward class feature
 * 
 * @returns {Actor[]} - The actors with the Projected Ward class feature
 */
function getActorsWithProjectedWard() {
	const actors = game.actors.contents;
	const actorsWithProjectedWard = [];
	for(const actor of actors) {
		if(actor.type === 'character' && hasArcaneWardEffect(actor) && hasProjectedWard(actor)) {
			actorsWithProjectedWard.push(actor);
		}
	}

	return actorsWithProjectedWard;
}

/**
 * Check if the actor has the Projected Ward class feature
 * 
 * @param {Actor} actor - The actor to check
 * @returns {boolean} - True if the actor has the Projected Ward class feature, false otherwise
 */
function hasProjectedWard(actor) {
	return actor.items.find(item => item.type === 'feat' && (item.name.includes('Projected Ward') || item.name.includes('投射守御'))) ? true : false;
}

/**
 * Get the current HP of the Arcane Ward
 * 
 * @param {Actor} actor - The actor to check
 * @returns {number} - The current HP of the Arcane Ward
 */
function getArcaneWardHP(actor) {
	const ward = getArcaneWard(actor);
	return ward.system.uses.value;
}

/**
 * Get the maximum HP of the Arcane Ward
 * 
 * @param {Actor} actor - The actor to check
 * @returns {number} - The maximum HP of the Arcane Ward
 */
function getArcaneWardHPMax(actor) {
	const ward = getArcaneWard(actor);
	return ward.system.uses.max;
}

/**
 * Check if a spell is Abjuration spell
 * 
 * @param {Spell} spell - The spell to check
 * @returns {boolean} - True if the spell is Abjuration, false otherwise
 */
function isAbjurationSpell(spell, ABJURATION_SCHOOLS) {
	if (!spell.system.school) return false;
	return ABJURATION_SCHOOLS.some(school => 
		spell.system.school.toLowerCase().includes(school)
	);
}



/**
 * Get the distance between two actors
 * 
 * @param {Token} sourceToken - The source token
 * @param {Token} targetToken - The target token
 * @param {Object} options - The options for the distance calculation
 * @param {boolean} options.wallsBlock - Whether to consider walls in the distance calculation
 * @param {boolean} options.checkCover - Whether to consider cover in the distance calculation
 * @returns {number} - The distance between the two actors
 */
function getDistance(sourceToken, targetToken, {wallsBlock, checkCover} = {}) {
	return MidiQOL.computeDistance(sourceToken, targetToken, {wallsBlock, includeCover: checkCover});
}

/**
 * Generate a witty message for the actor
 * 
 * @param {Actor} actor - The actor to check
 * @param {Actor} target - The target of the actor
 * @param {string} scope - The scope of the message, "firstPerson" or "thirdPerson"
 * @returns {string} - The witty message
 */
function generateWittyMessage(actor, target, scope = "firstPerson") {

	const wittyMessages = getFormattedMessages(actor, target);

	const message = wittyMessages[scope][Math.floor(Math.random() * wittyMessages[scope].length)];

	let result = '';

	if(scope === "firstPerson") {
		result = `<p>${message}.</p>`;
	} else {
		result = `<p><strong>${actor.name}</strong> ${message}.</p>`;
	}

	return result;
}


/**
 * Generate a witty message for the projected ward
 * 
 * @param {Actor} actor - The actor to check
 * @param {Actor} target - The target of the actor
 * @param {Actor} attacker - The attacker of the actor
 * @param {string} scope - The scope of the message, "actor" or "attacker"
 * @returns {string} - The witty message
 */
function generateWittyMessagePW(actor, target, attacker, scope = "actor") {

	const wittyMessages = getFormattedPWMessages(actor, target, attacker);

	return `<p>${wittyMessages[scope][Math.floor(Math.random() * wittyMessages[scope].length)]}</p>`;

}

/**
 * Get the formatted messages for the witty message
 * 
 * @param {Actor} actor - The actor to check
 * @param {Actor} target - The target of the actor
 * @param {Actor} attacker - The attacker of the actor
 * @returns {Object} - The formatted messages
 */
function getFormattedPWMessages(actor, target, attacker) {

	const wittyMessagesActor = game.i18n.translations.ARCANE_WARDING.WITTY_MESSAGES.ACTOR;
	const wittyMessagesAttacker = game.i18n.translations.ARCANE_WARDING.WITTY_MESSAGES.ATTACKER;

	let formattedMessages = {
		actor: [],
		attacker: []
	};

	Object.keys(wittyMessagesActor).forEach(key => {
		formattedMessages['actor'].push(game.i18n.format(wittyMessagesActor[key], {target: target.name, actor: actor.name}));
	});

	Object.keys(wittyMessagesAttacker).forEach(key => {
		formattedMessages['attacker'].push(game.i18n.format(wittyMessagesAttacker[key], {target: target.name, attacker: attacker.name}));
	});

	return formattedMessages;
}

/**
 * Get the formatted messages for the witty message
 * 
 * @param {Actor} actor - The actor to check
 * @param {Actor} target - The target of the actor
 * @returns {Object} - The formatted messages
 */
function getFormattedMessages(actor, target) {

	const wittyMessagesFirstPerson = game.i18n.translations.ARCANE_WARDING.WITTY_MESSAGES.FIRST_PERSON;
	const wittyMessagesThirdPerson = game.i18n.translations.ARCANE_WARDING.WITTY_MESSAGES.THIRD_PERSON;

	let formattedMessages = {
		firstPerson: [],
		thirdPerson: []
	};

	Object.keys(wittyMessagesFirstPerson).forEach(key => {
		formattedMessages['firstPerson'].push(game.i18n.format(wittyMessagesFirstPerson[key], {target: target.name, actor: actor.name}));
	});

	Object.keys(wittyMessagesThirdPerson).forEach(key => {
		formattedMessages['thirdPerson'].push(game.i18n.format(wittyMessagesThirdPerson[key], { target: target.name, actor: actor.name }));
	});

	return formattedMessages;
}


/**
 * Check if the actor should skip the projected ward
 * 
 * @param {Actor} actor - The actor to check
 * @param {Actor} target - The target of the actor
 * @param {Actor} attacker - The attacker of the actor
 * @returns {boolean} - True if the actor should skip the projected ward, false otherwise
 */
function shouldSkip(actor, target, attacker) {

	let skip = false;

	// check if the ward has any remaining hp, if not, skip the rest of the loop
	const currentWardHP = getArcaneWardHP(actor);
	if(currentWardHP === 0) {
		skip = true;
	}

	// if the actor is more than 30 feet away from the target, skip the rest of the loop
	const distance = getDistance(actor, target, {wallsBlock: true, checkCover: true});
	if(distance === -1 || distance > 30) {
		skip = true;
	}

	// if the actor is the attacker, skip the rest of the loop
	if(actor === attacker) {
		skip = true;
	}

	return skip;
}

/**
 * Check if the actor should use full messaging
 * 
 * @param {Actor} actor - The actor to check
 * @returns {boolean} - True if the actor should use full messaging, false otherwise
 */
function useFullMessaging(actor) {
	const wardFeature = getArcaneWard(actor);
	return wardFeature.flags?.arcaneWarding?.fullMessaging;
}

export { 
	sendMessage, 
	isAbjurerWizard, 
	getArcaneWard, 
	hasArcaneWard, 
	getArcaneWardEffect, 
	hasArcaneWardEffect,
	getActorsWithProjectedWard,
	hasProjectedWard, 
	getArcaneWardHP, 
	getArcaneWardHPMax, 
	isAbjurationSpell, 
	getDistance, 
	generateWittyMessage,
	generateWittyMessagePW,
	shouldSkip,
	useFullMessaging
};