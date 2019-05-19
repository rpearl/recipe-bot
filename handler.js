'use strict';
const querystring = require('querystring');
const Airtable = require('airtable');
const Slack = require('slack');
const randomSample = require('lodash.samplesize');

const bot = new Slack({token: process.env.SLACK_BOT_TOKEN});
const base = new Airtable().base('appFFph4k0QMqckaK');

const channel = 'food';

async function getAllSources(specialities = ['']) {
    const records = [];
    const args = specialities.map(speciality => `speciality="${speciality}"`).join(', ');
    const formula = `OR(${args})`;
    await base('Sources').select({
        view: 'recipebot',
        'fields': ['Name', 'Media/Cover', 'Recipe Count', 'Author'],
        'filterByFormula': formula,
    }).eachPage((page, next) => {
        for (const record of page) {
            records.push(record);
        }
        next();
    });
    return records;
}

async function getAuthors(sources) {
    const authorRecordIds = new Set();
    for (const source of sources) {
        const authors = source.get('Author') || [];
        for (const authorRecordId of authors) {
            authorRecordIds.add(authorRecordId);
        }
    }
    const args = Array.from(authorRecordIds).map(recordId => `RECORD_ID() = "${recordId}"`).join(', ');
    const formula = `OR(${args})`;
    const authorsById = new Map();
    await base('Authors').select({
        'fields': ['Name'],
        'filterByFormula': formula
    }).eachPage((page, next) => {
        for (const record of page) {
            authorsById.set(record.id, record.get('Name'));
        }
        next();
    });
    return authorsById;
}

function formatNounList(nounList) {
    if (nounList.length === 1) {
        return nounList[0];
    } else if (nounList.length === 2) {
        return `${nounList[0]} and ${nounList[1]}`;
    } else {
        let first = true;
        return nounList.slice(0, -1).join(', ') + ', and ' + nounList[nounList.length - 1];
    }
}

function reformatBlockFromPayload(block) {
    if (block.type === 'divider') {
        return {type: 'divider'};
    } else if (block.type === 'section') {
        const {text} = block;
        let accessory;
        if (block.accessory) {
            accessory = {
                type: 'image',
                image_url: block.accessory.image_url,
                alt_text: block.accessory.alt_text,
            };
        }
        return {
            type: 'section',
            text,
            accessory,
        };
    } else {
        return block;
    }
}

function formatTitle(source, authorsById) {
    const title = source.get('Name');
    const url = `https://airtable.com/tblu6Knj4SHo2O6o6/${source.id}`;
    const authorIds = source.get('Author') || [];
    const authorNames = authorIds.length > 0 ? ' by ' + formatNounList(authorIds.map(id => authorsById.get(id))) : '';

    return `*<${url}|${title}>*${authorNames}`;
}

function formatSource(source, authorsById) {
    const title = source.get('Name');
    const attachments = source.get('Media/Cover') || [];

    const text =
`${formatTitle(source, authorsById)}
${source.get("Recipe Count")} recipes`;

    let accessory = undefined;
    if (attachments.length > 0) {
        accessory = {
            type: "image",
            image_url: attachments[0].url,
            alt_text: source.get('Name'),
        }
    };

    const block = {
        type: "section",
        text: {
            type: "mrkdwn",
            text,
        },
        accessory,
    };
    return block;
}

function disableAction(block, target_action_id) {

    const elements = block.elements.map(element => {
        let action_id = element.action_id;
        let text = element.text.text;
        if (action_id === target_action_id) {
            action_id += 'disabled';
            text += ' :heavy_check_mark:';
        }

        return {
            type: 'button',
            action_id,
            text: {
                type: "plain_text",
                emoji: true,
                text,
            }
        };
    });

    return {
        type: 'actions',
        elements,
    };
}

async function sendSpeciality(payload, action_id, specialities) {
    const {message, response_url} = payload;
    const sources = await getAllSources(specialities);
    const selected = randomSample(sources, 1);
    const authorsById = await getAuthors(selected);

    const text = message.text;
    const blocks = [
        ...message.blocks.slice(0, -1).map(reformatBlockFromPayload),
        {type: 'divider'},
        formatSource(selected[0], authorsById),
        disableAction(message.blocks[message.blocks.length-1], action_id),
    ];
    await bot.chat.update({
        channel: payload.channel.id,
        ts: message.ts,
        text,
        blocks,
    });
}

module.exports.handleButton = async (event, context, callback) => {
    const data = querystring.parse(event.body);
    const payload = JSON.parse(data.payload);
    const response_url = payload['response_url'];
    const action = payload.actions[0];
    let specialities;
    if (action.action_id === "dessert") {
        specialities = ['dessert'];
    } else if (action.action_id === 'drinks') {
        specialities = ['drinks'];
    }
    if (specialities) {
        await sendSpeciality(payload, action.action_id, specialities);
    }
    return {
        statusCode: 200,
        body: '',
    };
}

function button({text, action_id}) {
    return {
        type: "button",
        text: {
            type: "plain_text",
            text,
            emoji: true
        },
        action_id,
    };
}

module.exports.getRandomSources = async (event) => {
    const sources = await getAllSources();
    const selected = randomSample(sources, 5);
    const authorsById = await getAuthors(selected);

    const blocks = [{
        type: "section",
        text: {
            type: "mrkdwn",
            text: "Here's five cookbooks for meal planning",
        },
    }];
    for (const source of selected) {
        blocks.push({type: 'divider'});
        blocks.push(formatSource(source, authorsById));
    }

    blocks.push({
        type: 'actions',
        elements: [
            button({text: ':cake: Add Dessert', action_id: 'dessert'}),
            button({text: ':tropical_drink: Add Drink', action_id: 'drinks'}),
        ],
    });

    const titles = selected.map(source => formatTitle(source, authorsById));

    await bot.chat.postMessage({
        channel,
        text: `Here's five cookbooks for meal planning: ${formatNounList(titles)}`,
        blocks,
    });

  return {
    statusCode: 200,
    body: blocks,
  };
}
