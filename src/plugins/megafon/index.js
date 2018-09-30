import * as megafon from "./megafon";

export async function scrape({preferences, fromDate, toDate, isInBackground}) {
    const sessionId = ZenMoney.getData("session_id", null);
    const auth = await megafon.login(preferences, isInBackground, {sessionId: sessionId});
    return {
        accounts: [],
        transactions: [],
    };
}
