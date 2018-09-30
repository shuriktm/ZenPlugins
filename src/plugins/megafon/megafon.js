import _ from "lodash";
import * as network from "../../common/network";

const baseUrl = "https://bank.megafon.ru/";

async function fetchJson(url, options, predicate = () => true) {
    const response = await network.fetchJson(baseUrl + url, {
        method: options.method || "POST",
        ..._.omit(options, ["method"]),
    });
    if (predicate) {
        validateResponse(response, response => response.body && !response.body.error && predicate(response));
    }
    return response;
}

async function fetchForm(url, data, options, predicate = () => true) {
    const params = [];
    for (let param in data) {
        if (data.hasOwnProperty(param)) {
            params.push(`${encodeURIComponent(param)}=${encodeURIComponent(data[param])}`);
        }
    }
    options = options || {};
    options = {
        method: "POST",
        headers: {
            ...options.headers,
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: params.join("&"),
        stringify: null,
        sanitizeRequestLog: {
            ...options.sanitizeRequestLog,
            body: true,
        },
        ..._.omit(options, ["method", "headers", "body", "stringify"]),
    };
    return fetchJson(url, options, predicate);
}

async function fetchHtml(url, options) {
    options = options || {};
    options = {
        method: options.method || "GET",
        headers: {
            ...options.headers,
            "Accept": "text/html,application/xhtml+xml,application/xml",
            "Content-Type": "text/html; charset=utf-8",
        },
        ..._.omit(options, ["method", "headers"]),
    };
    return network.fetch(url, options);
}

function validateResponse(response, predicate) {
    console.assert(!predicate || predicate(response), "non-successful response");
}

export async function login(preferences, isInBackground, auth) {
    if (auth.sessionId) {
        console.log(">>> Cессия уже установлена. Используем её.");
    } else {
        if (isInBackground) {
            throw new TemporaryError(">>> Необходима регистрация по SMS-коду. Запрос в фоновом режиме не возможен. Прекращаем работу.");
        }
        console.log(">>> Пытаемся войти...");
        const response = await fetchHtml(baseUrl);
        if (response.status !== 200) {
            throw new TemporaryError("Ошибка: сайт банка недоступен");
        }
        let csrf = /var csrf ='(.*)';/i.exec(response.body);
        if (!csrf || !csrf[1]) {
            throw new Error("Ошибка: не удалось получить токен для запроса");
        }
        csrf = csrf[1];
        console.log(">>> CSRF токен для отправки формы: " + csrf);
        const register = (await fetchForm("user/register", {
            phone_number: preferences.phone,
            password: "",
            _csrf: csrf,
        }));
        if (response.status !== 200) {
            throw new TemporaryError("Ошибка: не удалось проверить пользователя");
        }
        if (register.body.error_code !== 6) {
            throw new Error(register.body.error_message);
        }
        const login = (await fetchForm("user/login", {
            phone_number: preferences.phone,
            password: preferences.password,
            _csrf: csrf,
        }));
        if (login.status !== 200) {
            throw new TemporaryError("Ошибка: не удалось авторизоваться");
        } else if (login.body.error_message) {
            throw new Error(login.body.error_message);
        }

        console.log(">>> Токен подтверждения: " + csrf);
        console.log(">>> Необходимо подтвердить вход...");

        const code = await ZenMoney.readLine("Введите код активации из СМС сообщения");
        const confirm = (await fetchForm("user/login/confirm", {
            code: code,
            confirmation_id: login.body.confirmation_id,
            _csrf: csrf,
        }, {
            sanitizeResponseLog: {body: {"profile_id": true, "session_id": true}},
        }));
        if (confirm.status !== 200) {
            throw new TemporaryError("Ошибка: не удалось отправить код активации");
        } else if (confirm.body.error_message) {
            throw new Error(confirm.body.error_message);
        } else if (!confirm.body.success) {
            throw new Error("Ошибка: не удалось установить сессию");
        }

        console.log(">>> Успешно вошли по коду активации.");

        ZenMoney.setData("profile_id", confirm.body.profile_id);
        ZenMoney.setData("session_id", confirm.body.session_id);

        return {
            profileId: confirm.body.profile_id,
            sessionId: confirm.body.session_id,
        };
    }
}
