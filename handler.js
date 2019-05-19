'use strict';

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
        for (const authorRecordId of source.get('Author')) {
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

function formatTitle(source, authorsById) {
    const title = source.get('Name');
    const url = `https://airtable.com/tblu6Knj4SHo2O6o6/${source.id}`;
    const authorIds = source.get('Author');
    const authorNames = formatNounList(authorIds.map(id => authorsById.get(id)));
    return `*<${url}|${title}>* by ${authorNames}`;
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

};
