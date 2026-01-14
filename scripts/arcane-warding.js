import { sendMessage, isAbjurerWizard, getArcaneWard, hasArcaneWard, getArcaneWardEffect, hasArcaneWardEffect, getArcaneWardHP, isAbjurationSpell, generateWittyMessage, generateWittyMessagePW, shouldSkip, getActorsWithProjectedWard, useFullMessaging } from './utils.js';
import { registerSocket, SOCKET_NAME } from './socket.js';

/**
 * Arcane Warding Module for Foundry VTT
 * Automates the Abjurer wizard's Arcane Ward feature
 */
class ArcaneWarding {
    constructor() {
        this.ABJURATION_SCHOOLS = ['abjuration', 'abj'];
        this.ABJURER_SUBCLASS = ['Abjurer', 'School of Abjuration', '防护学派', '防护师'];
        this.langs = {};
        this.initialize();
    }

    async initialize() {
        // Register hooks when the module is ready
        Hooks.once('ready', () => {
            this.registerHooks();
            // get all the actors
            if(game.user.isGM) {
                const actors = game.actors.contents;
                actors.forEach(actor => {
                    let isAbjurer = isAbjurerWizard(actor, this.ABJURER_SUBCLASS);
                    let hasWard = hasArcaneWard(actor);
                    if(actor.type === 'character' && isAbjurer && hasWard) {
                        const wardFeature = getArcaneWard(actor);
                        if(wardFeature) this.createArcaneWard(wardFeature, actor);
                    }
                });
            }
        });

    }

    registerHooks() {
        // add the toggle messages button to the item sheet for v13
        Hooks.on('renderItemSheet5e', this.onRenderItemSheet5e.bind(this));
        // add the toggle messages button to the item sheet for v12
        Hooks.on('renderItemSheet5es', this.onRenderItemSheet5e.bind(this));

        // Monitor spell casting hooks - after spell is cast
        Hooks.on('midi-qol.RollComplete', this.onSpellCast.bind(this));

        // add a hook for when the actor takes a long rest
        Hooks.on('dnd5e.restCompleted', this.onRestCompleted.bind(this));

        // add a hook for when the actor takes damage
        Hooks.on('midi-qol.preTargetDamageApplication', this.handleWardDamage.bind(this));

        // add a hook for the for Projected Ward triggering
        Hooks.on('midi-qol.AttackRollComplete', this.triggerProjectedWard.bind(this));
    }

    /**
     * Trigger the Projected Ward
     * 
     * @param {Object} workflow - The workflow object passed in by the midi-qol.AttackRollComplete hook
     */
    async triggerProjectedWard(workflow) {

        const hitDisplayData = workflow.hitDisplayData;

        const key = Object.keys(hitDisplayData)[0];

        const isHit = hitDisplayData[key].hitClass === 'success';

        const attacker = workflow.actor;
        const item = workflow.item;

        const targetActor = hitDisplayData[key].target.actor;

        if(isHit && !targetActor.effects.find(ef => ef.name === game.i18n.format('ARCANE_WARDING.EFFECT_NAME'))) {

            // get the actors that have the projected ward feature
            const actors = getActorsWithProjectedWard();
            for(const actor of actors) {
                // check if the actor should skip triggering the projected ward
                if(shouldSkip(actor, targetActor, attacker)) {
                    continue;
                }

                const result = await this.createDialog(item, "PROJECTED_WARD", actor, attacker, targetActor, false, 3);

                if(result === 'yes') {

                    // get the arcane ward feature
                    const wardFeature = getArcaneWard(actor);
                    // add the arcane ward effect to the target
                    const effect = getArcaneWardEffect(wardFeature);

                    if(effect) {
                        const success = await this.applyArcaneWardEffect(actor, targetActor);
                        if(success) {
                            if(useFullMessaging(actor)) {
                                sendMessage(game.i18n.format('ARCANE_WARDING.PROJECTED_WARD_APPLIED', { actor: actor.name, target: targetActor.name }), actor);
                            }
                            Hooks.once('midi-qol.preTargetDamageApplication', this.handleProjectedWardDamage.bind(this));
                        }
                    }
                } else {
                    return true;
                }
            }
        } else {
            // 这里删除了未命中时的嘲讽逻辑
            /*
            const sendMsg = workflow._diceRoll === 1 ? true : Math.random() < 0.5 ? true : false;
            
            if(sendMsg) {
                const msg = generateWittyMessage(targetActor, attacker, "firstPerson");
                sendMessage(msg, targetActor, "emote", true);
            }
            */
        }
        return true;
    }

    /**
     * Handle the damage to the Arcane Ward and the actor
     * 
     * @param {Token} token - The token that took damage
     * @param {Object} data - The data consists of the workflow and the item doing the damage
     */
    async handleProjectedWardDamage(token, {workflow, ditem}) {
        const attacker = workflow.actor;

        const target = game.actors.get(ditem.actorId);

        const actors = getActorsWithProjectedWard();
        for(const actor of actors) {

            const wardFeature = getArcaneWard(actor);

            const currentWardHP = getArcaneWardHP(actor);
            const totalDamage = ditem.totalDamage;
            const damageToAbsorb = Math.min(currentWardHP, totalDamage);
            const remainingDamage = totalDamage - damageToAbsorb;
            ditem.totalDamage = remainingDamage;
            ditem.hpDamage = remainingDamage;
            ditem.damageDetail.forEach(dd => { dd.value = remainingDamage;});

            const newWardHP = currentWardHP - damageToAbsorb;
            const newSpent = wardFeature.system.uses.max - newWardHP;
            await wardFeature.update({ "system.uses.spent": newSpent });

            // remove the arcane ward effect from the target
            const targetEffect = target.effects.find(ef => ef.name === game.i18n.format('ARCANE_WARDING.EFFECT_NAME'));
            if(targetEffect) {
                await targetEffect.delete();
            }

            let message = game.i18n.format('ARCANE_WARDING.PROJECTED_WARD_ABSORBED_BASE', { actor: actor.name, target: target.name, attacker: attacker.name });

            if(newWardHP === 0) {
                message += game.i18n.format('ARCANE_WARDING.PROJECTED_WARD_ABSORBED_0HP', { actor: actor.name, target: target.name });
            } else {
                message += game.i18n.format('ARCANE_WARDING.PROJECTED_WARD_ABSORBED_SUCCESS', { actor: actor.name, target: target.name });
            }

            if(useFullMessaging(actor)) {
                sendMessage(message, actor);
            }

            if(remainingDamage === 0) {
                // 已禁用投射结界完全吸收伤害时的俏皮话
                /*
                // generate a random message for the target to say to the actor (or the attacker)
                let scope = Math.random() < 0.5 ? "attacker" : "actor";
                
                let wittyPWMessage = generateWittyMessagePW(actor, target, attacker, scope);

                if(useFullMessaging(actor)) {
                    sendMessage(wittyPWMessage, target, "emote", true);
                }
                */
            }

            return true;
        }
    }

    /**
     * Render the item sheet for the Arcane Ward
     * 
     * @param {Object} sheet - The sheet object
     * @param {string} html - The html of the sheet
     * @param {Object} data - The data of the sheet
     */
    async onRenderItemSheet5e(sheet, html, data) {
        const $html = $(html);

        const item = data.item;
        if (!item || (!item.name.includes('Arcane Ward') && !item.name.includes('奥术守御'))) return;

        // Ensure the flag is present
        if (item.flags?.arcaneWarding?.fullMessaging === undefined) {
            await item.update({ 'flags.arcaneWarding.fullMessaging': false }, { render:false
            });
        }
        
        // Determine automation state
        const enabled = item.flags?.arcaneWarding?.fullMessaging ?? false;

        const icon = enabled ? 'fa-toggle-on' : 'fa-toggle-off';

        const btn = $(`
            <div class="arcane-ward-wrap ${enabled ? 'arcane-ward-wrap-enabled' : 'arcane-ward-wrap-disabled'}">
                <p class="arcane-ward-toggle-title">Toggle Messages</p>
                <span class="arcane-ward-toggle-icon"><i class="fas ${icon}"></i> ${enabled ? 'Enabled' : 'Disabled'}</span>
                <input type="checkbox" class="arcane-ward-toggle" ${enabled ? 'checked' : ''}>
                <label for="arcane-ward-toggle"></label>
            </div>
        `);

        btn.on('click', async (event) => {
            event.preventDefault();
            
            const currentEnabled = item.flags?.arcaneWarding?.fullMessaging ?? false;
            const newEnabled = !currentEnabled;

            await item.update({ 'flags.arcaneWarding.fullMessaging': newEnabled }, { render: false });

            // Update UI elements directly
            const $wrap = $(event.currentTarget);
            $wrap.toggleClass('arcane-ward-wrap-enabled', newEnabled).toggleClass('arcane-ward-wrap-disabled', !newEnabled);
            
            const $span = $wrap.find('.arcane-ward-toggle-icon');
            const iconClass = newEnabled ? 'fa-toggle-on' : 'fa-toggle-off';
            const text = newEnabled ? 'Enabled' : 'Disabled';
            $span.html(`<i class="fas ${iconClass}"></i> ${text}`);
            
            const $checkbox = $wrap.find('input.arcane-ward-toggle');
            $checkbox.prop('checked', newEnabled);
        });

        const sheetHeader = $html.find('.window-content .sheet-header .right');
        if (sheetHeader.length > 0 && !$html.find('.arcane-ward-wrap').length) {
            sheetHeader.append(btn);
        }
    }

    /**
     * Create the Arcane Ward effect
     * 
     * @param {Item} wardFeature - The Arcane Ward feature
     * @param {Actor} actor - The actor that cast the spell
     */
    async createArcaneWard(wardFeature, actor) {
        if (!wardFeature) {
            sendMessage(game.i18n.format('ARCANE_WARDING.MISSING_FEATURE'), actor);
            return;
        }

        // --- Effect Handling ---
        let effect = getArcaneWardEffect(wardFeature);

        if (!effect) {
            await wardFeature.update({ "system.uses.spent": 0 });
            const effectData = {
                name: game.i18n.format('ARCANE_WARDING.EFFECT_NAME'),
                label: game.i18n.format('ARCANE_WARDING.EFFECT_LABEL'),
                description: wardFeature.system.description.value,
                icon: "icons/magic/defensive/shield-barrier-flaming-pentagon-blue-yellow.webp",
                origin: wardFeature.uuid,
                disabled: false,
                transfer: false,
                flags: {
                    dae: { showIcon: true, specialDuration: ["longRest"] }
                }
            };
            // After creation, the effect will be on the wardFeature, so we can get it.
            const [createdEffect] = await wardFeature.createEmbeddedDocuments("ActiveEffect", [effectData]);
            effect = createdEffect; // Use the returned created effect
            console.log(`%cArcane Warding | Arcane Ward effect created for ${actor.name}.`, "color: #00ff00");
        }

        if (!effect) {
            console.error("%cArcane Warding | Failed to get or create the effect.", "color: #ff0000");
            return;
        }

        // --- Activity Handling ---
        const activities = foundry.utils.deepClone(wardFeature.system.activities);

        let createWardActivity = null;

        if(wardFeature.system._source.source.rules === '2014') {
            createWardActivity = activities.find(activity => activity.name === "Midi Use");
        } else {
            createWardActivity = activities.find(activity => activity.name === "Create Ward");
        }

        if (!createWardActivity) {
            console.log(`%cArcane Ward | Missing 'Create Ward' activity for ${actor.name}.`, "color: #ff0000");
            return;
        }

        if (!createWardActivity.effects) {
            createWardActivity.effects = [];
        }

        if (!createWardActivity.effects.includes(effect.uuid)) {
            createWardActivity.effects.push(effect.uuid);
            await wardFeature.update({ "system.activities": activities });
            // check if the activity has the effect
            if(createWardActivity.effects.includes(effect.uuid)) {
            console.log(`%cArcane Ward | Linked effect to 'Create Ward' activity for ${actor.name}.`, "color: #00ff00");
            } else {
                console.log(`%cArcane Ward | Effect not linked to 'Create Ward' activity for ${actor.name}.`, "color: #ff0000");
            }
        } else {
            console.log(`%cArcane Ward | Effect already linked to 'Create Ward' activity for ${actor.name}.`, "color: #ffff00");
        }
        return;
    }


    /**
     * Heal the Arcane Ward
     * 
     * @param {Item} wardFeature - The Arcane Ward feature
     * @param {Spell} spell - The spell that was cast
     */
    async healArcaneWard(wardFeature, spell, spellLevel) {

        const currentSpent = wardFeature.system.uses.spent;

        if (currentSpent === 0) {
            if(useFullMessaging(wardFeature.actor)) {
                sendMessage(game.i18n.format('ARCANE_WARDING.WARD_AT_MAX', { actor: wardFeature.actor.name }), wardFeature.actor);
            }
            return {
                success: false
            }
        }

        const healAmount = spellLevel * 2;

        const newSpent = Math.max(0, currentSpent - healAmount);
        
        await wardFeature.update({ "system.uses.spent": newSpent });
        
        return {
            success: true,
            requested: healAmount,
            actual: healAmount,
            item: wardFeature
        }
    }

    /**
     * Handle the damage to the Arcane Ward and the actor
     * 
     * @param {Token} token - The token that took damage
     * @param {Object} data - The data consists of the workflow and the item doing the damage
     */
    async handleWardDamage(token, {workflow, ditem}) {

        // If the "damage" is actually healing, or the attack missed, don't absorb it with the ward.
        if (ditem.damageDetail.some(detail => detail.type === 'healing') || !ditem.isHit) {
            return true;
        }

        const actor = token.actor;
        const wardFeature = getArcaneWard(actor);
        const attacker = workflow.token;
        if (!isAbjurerWizard(actor, this.ABJURER_SUBCLASS) || !hasArcaneWardEffect(actor)) return true;

        let currentWardHP = getArcaneWardHP(actor);

        if (currentWardHP === 0) return true;

        const totalDamage = ditem.totalDamage;
        if (totalDamage === 0) return true;

        const damageToAbsorb = Math.min(currentWardHP, totalDamage);
        const remainingDamage = totalDamage - damageToAbsorb;

        ditem.totalDamage = remainingDamage;
        ditem.hpDamage = remainingDamage;
        ditem.damageDetail.forEach(dd => { dd.value = remainingDamage;});
        
        const newWardHP = currentWardHP - damageToAbsorb;
        const newSpent = wardFeature.system.uses.max - newWardHP;

        await wardFeature.update({ "system.uses.spent": newSpent });

        let message = game.i18n.format('ARCANE_WARDING.ABSORBED_MESSAGE_BASE', { actor: actor.name, amount: Math.ceil(damageToAbsorb) });

        if (newWardHP === 0) {
            message += game.i18n.format('ARCANE_WARDING.ABSORBED_MESSAGE_0HP', { actor: actor.name });
            if(remainingDamage > 0) {
                message += game.i18n.format('ARCANE_WARDING.ABSORBED_MESSAGE_REMAINING_DMG', { actor: actor.name, remaining: Math.ceil(remainingDamage) }); 
            } else {
                message += game.i18n.format('ARCANE_WARDING.ABSORBED_MESSAGE_NO_DMG', { actor: actor.name });
            }
        } else {
            message += game.i18n.format('ARCANE_WARDING.ABSORBED_MESSAGE_SUCCESS', { actor: actor.name });
        }

        if(useFullMessaging(actor)) {
            sendMessage(message, actor);
        }

        if (remainingDamage === 0) {
             // 已禁用自身结界完全吸收伤害时的俏皮话
             /*
            // determine the scope of the message
            const scope = Math.random() < 0.5 ? "firstPerson" : "thirdPerson";

            // generate the witty message based on the scope
            let wittyMessage = generateWittyMessage(actor, attacker, scope);
            
            // defaults for type of message and if we should use a bubble
            let useBubble = false;
            let type = "publicroll";

            // if the message is first person, we should use a bubble
            if(scope === "firstPerson") {
                useBubble = true;
                type = "emote";
            }

            if(useFullMessaging(actor)) {
                sendMessage(wittyMessage, actor, type, useBubble);
            }
            */
        }
        
        return true;
    }

    /**
     * Handle the long rest
     * 
     * @param {Actor} actor - The actor that took a long rest
     * @param {Object} data - The data object from the long rest
     */
    async onRestCompleted(actor, data) {
        if(hasArcaneWardEffect(actor) && data.type === 'long' && useFullMessaging(actor)) {
            sendMessage(game.i18n.format('ARCANE_WARDING.LONG_REST', { actor: actor.name }), actor);
        }
    }

    /**
     * Handle spell casting
     * 
     * @param {Object} workflow - The workflow object from Midi-QOL
     */
    async onSpellCast(workflow) {
        if (workflow.item?.type !== 'spell' || workflow.actor.type !== 'character') return;

        const actor = workflow.actor;
        if (!isAbjurerWizard(actor, this.ABJURER_SUBCLASS)) return;

        const spell = workflow.item;
        let spellLevel = spell.system.level;
        if(workflow?.castData?.castLevel !== workflow?.castData?.baseLevel) {
            // the spell was upcast so we need to update the spell level
            spellLevel = workflow.castData.castLevel;
        }

        const isAbjSpell = isAbjurationSpell(spell, this.ABJURATION_SCHOOLS);

        if (!isAbjSpell) return;

        await this.processAbjurationSpell(actor, spell, spellLevel);
    }

    /**
     * Process an Abjuration spell cast
     * 
     * @param {Actor} actor - The actor that cast the spell
     * @param {Spell} spell - The spell that was cast
     */
    async processAbjurationSpell(actor, spell, spellLevel) {
        const wardFeature = getArcaneWard(actor);
        const hasWardEffect = actor.effects.find(ef => ef.name === game.i18n.format('ARCANE_WARDING.EFFECT_NAME'));
        
        // If no ward exists, ask if they want to create one
        if (!hasWardEffect) {
            const result = await this.createDialog(spell, "ARCANE_WARD", actor);
            if(result === 'yes') {
                // Find the "Create Ward" activity and apply its effects
                let createWardActivity = null;
                if(wardFeature.system._source.source.rules === '2014') {
                    createWardActivity = wardFeature.system.activities.find(a => a.name === "Midi Use");
                } else {
                    createWardActivity = wardFeature.system.activities.find(a => a.name === "Create Ward");
                }

                if (createWardActivity) {
                    wardFeature.system.uses.spent = 0;
                    await wardFeature.update({ "system.uses.spent": 0 });
                    const effect = getArcaneWardEffect(wardFeature);
                    if (effect) {
                        await actor.createEmbeddedDocuments("ActiveEffect", [effect.toObject()]);
                        if(useFullMessaging(actor)) {
                            sendMessage(game.i18n.format('ARCANE_WARDING.EFFECT_CREATED', { actor: actor.name }), actor);
                        }
                    }
                }
            }
        } else {
            // If the ward exists, heal it
            if (spellLevel === 0) {
                return; // Abjuration cantrips do not charge the ward.
            }

            const result = await this.healArcaneWard(wardFeature, spell, spellLevel);

            if(result.success) {
                if(useFullMessaging(actor)) {
                    sendMessage(game.i18n.format('ARCANE_WARDING.WARD_HEALED', { actor: actor.name }), actor);
                }
            }
        }
    }

    /**
     * Create a dialog to ask the user if they want to use their Arcane Ward
     * 
     * @param {Spell} spell - The spell that was cast or the item that was used to attack
     * @param {string} type - The type of dialog to create: "ARCANE_WARD" or "PROJECTED_WARD"
     * @param {Actor} actor - The actor that is casting the spell or the actor that has the arcane ward
     * @param {Actor} attacker - The actor that is attacking the target or the actor that is using the item or spell
     * @param {Actor} target - The actor that is being attacked or the actor that is being protected by the arcane ward
     * @param {boolean} fromSocket - Whether the dialog is being created from a socket
     */
    async createDialog(spell = null, type = "ARCANE_WARD", actor = null, attacker = null, target = null, fromSocket = false, timeout = null) {
        const owner = actor ? game.users.find(u => u.character?.id === actor.id && u.active && !u.isGM) : game.user;

        if (game.user.isGM && owner && owner.id !== game.user.id && !fromSocket) {
            return new Promise((resolve) => {
                const requestId = foundry.utils.randomID();
                game.socket.emit(SOCKET_NAME, {
                    type: 'createDialog',
                    user: owner.id,
                    payload: {
                        spellName: spell ? spell.name : null,
                        type: type,
                        actorId: actor ? actor.id : null,
                        attackerId: attacker ? attacker.id : null,
                        targetId: target ? target.id : null,
                        requestId: requestId,
                        timeout: timeout
                    }
                });

                const listener = (data) => {
                    if (data.type === 'dialogResult' && data.payload.originalRequest.requestId === requestId) {
                        game.socket.off(SOCKET_NAME, listener);
                        resolve(data.payload.result);
                    }
                };
                game.socket.on(SOCKET_NAME, listener);
            });
        }

        const data = {}
        if (spell) {
            data.spell = spell.name;
        }
        if (actor) {
            data.actor = actor.name;
        }
        if (attacker) {
            data.attacker = attacker.name;
        }
        if (target) {
            data.target = target.name;
        }

        const classes = ['arcane-warding-dialog'];
        if(type === 'PROJECTED_WARD') {
            classes.push('projected-ward-dialog');
        }

        const title = game.i18n.format(`ARCANE_WARDING.DIALOG.${type}.TITLE`, data);
        const content = game.i18n.format(`ARCANE_WARDING.DIALOG.${type}.CONTENT`, data);
        const yesLabel = game.i18n.format('ARCANE_WARDING.LABEL_YES');
        const noLabel = game.i18n.format('ARCANE_WARDING.LABEL_NO');

        if (game.release.generation >= 13) {
            return this._createDialogV13(title, content, yesLabel, noLabel, classes, timeout);
        } else {
            return this._createDialogLegacy(title, content, yesLabel, noLabel, timeout);
        }
    }

    /**
     * Create a dialog for v13
     * 
     * @param {string} title - The title of the dialog
     * @param {string} content - The content of the dialog
     * @param {string} yesLabel - The label for the yes button
     * @param {string} noLabel - The label for the no button
     * @param {string[]} classes - The classes for the dialog
     * @param {number} timeout - The timeout for the dialog
     * @returns {Promise<string>} The result of the dialog
     */
    _createDialogV13(title, content, yesLabel, noLabel, classes, timeout) {
        return new Promise((resolve) => {
            let timerId;
            let resolved = false;

            const complete = (result) => {
                if (resolved) return;
                resolved = true;
                if (timerId) clearTimeout(timerId);
                resolve(result);
            };

            const dialog = new foundry.applications.api.DialogV2({
                classes: classes,
                window: {title: title},
                content: content,
                buttons: [
                    { action: 'yes', label: yesLabel, callback: () => {
                        complete('yes');
                        dialog.close();
                    }},
                    { action: 'no', label: noLabel, callback: () => {
                        complete('no');
                        dialog.close();
                    }}
                ],
                default: 'no',
                close: () => {
                    complete('no');
                }
            });

            dialog.render(true);

            if (timeout) {
                timerId = setTimeout(() => {
                    complete('no');
                    dialog.close();
                }, timeout * 1000);
            }
        });
    }

    /**
     * Create a dialog for v12
     * 
     * @param {string} title - The title of the dialog
     * @param {string} content - The content of the dialog
     * @param {string} yesLabel - The label for the yes button
     * @param {string} noLabel - The label for the no button
     * @param {number} timeout - The timeout for the dialog
     * @returns {Promise<string>} The result of the dialog
     */
    _createDialogLegacy(title, content, yesLabel, noLabel, timeout) {
        return new Promise((resolve) => {
            let timerId;
            let resolved = false;

            const finalResolve = (result) => {
                if (resolved) return;
                resolved = true;
                if (timerId) clearTimeout(timerId);
                resolve(result);

            };

            const dialog = new Dialog({
                title: title,
                content: content,
                buttons: {
                    yes: {
                        icon: '<i class="fas fa-check"></i>',
                        label: yesLabel,
                        callback: () => finalResolve("yes")
                    },
                    no: {
                        icon: '<i class="fas fa-times"></i>',
                        label: noLabel,
                        callback: () => finalResolve("no")
                    }
                },
                default: 'no',
                close: () => finalResolve('no')
            });
            dialog.render(true);

            if (timeout) {
                timerId = setTimeout(() => dialog.close(), timeout * 1000);
            }
        });
    }

    /**
     * apply the arcane ward effect to the target
     * 
     * @param {Actor} actor - The actor that has the arcane ward effect
     * @param {Actor} target - The target to apply the effect to
     */
    async applyArcaneWardEffect(actor, target) {
        const effect = getArcaneWardEffect(actor);
        if(effect) {
            const newEffect = await target.createEmbeddedDocuments("ActiveEffect", [effect.toObject()]);
            if(newEffect) {
                return true;
            }
        }
        return false;
    }

}

// Initialize the module
Hooks.once('init', () => {
    game.arcaneWarding = new ArcaneWarding();
    registerSocket();
}); 