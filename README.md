# Ai-Browser-Remote-Control
Система управления браузером через Ai  
- click
- click_coords
- scroll
- type
- type_nth
- checkbox
- radio
- select
- navigate
- eval  
Нейросеть lp85d.ru отправляет команды в браузер по  API — расширение Chrome получает их и выполняет.   
Тестовая форма `https://lp85d.ru/test/`  
Регистрация в системе `https://lp85d.ru/wp-admin/`  
Плагин для браузера `https://github.com/dictovod/Ai-Browser-Remote-Control/`  
<img width="365" height="527" alt="image" src="https://github.com/user-attachments/assets/3ffe969f-ec2c-4bcb-9b9a-a4e789f1c71c" />

Вижу форму. Поля по порядку: 1-Имя, 2-Email, 3-Пароль, 4-Возраст, 5-Комментарий (textarea). Вот все команды для проверки:  

---

### 1. type — по селектору

```bash
# Имя (input[type=text])
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type\",\"selector\":\"input[name=name]\",\"value\":\"Иван Иванов\",\"clear\":true}}"

# Email
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type\",\"selector\":\"input[type=email]\",\"value\":\"test@example.com\",\"clear\":true}}"

# Пароль
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type\",\"selector\":\"input[type=password]\",\"value\":\"secret123\",\"clear\":true}}"

# Возраст
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type\",\"selector\":\"input[type=number]\",\"value\":\"25\",\"clear\":true}}"

# Комментарий (textarea)
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type\",\"selector\":\"textarea\",\"value\":\"Тестовый комментарий\",\"clear\":true}}"
```

---

### 2. type_nth — по номеру поля (новая команда)

```bash
# nth:1 = Имя
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type_nth\",\"nth\":1,\"value\":\"Иван\",\"clear\":true}}"

# nth:3 = Пароль
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type_nth\",\"nth\":3,\"value\":\"secret123\",\"clear\":true}}"

# nth:5 = Комментарий (textarea — тоже считается!)
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"type_nth\",\"nth\":5,\"value\":\"Привет из nth:5\",\"clear\":true}}"
```

---

### 3. Другие типы команд

```bash
# checkbox — поставить галку "Новости"
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"checkbox\",\"selector\":\"input[value=news]\",\"checked\":true}}"

# radio — выбрать "Женский"
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"radio\",\"selector\":\"input[value=female]\"}}"

# select — выбрать "Германия"
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"select\",\"selector\":\"select\",\"value\":\"Германия\"}}"

# click — нажать Отправить
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"click\",\"selector\":\"input[type=submit]\"}}"

# scroll — прокрутить вниз
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"scroll\",\"direction\":\"down\",\"amount\":300}}"

# navigate — перейти на другую страницу
curl -X POST "https://lp85d.ru/wp-json/brc/v1/command" -H "Authorization: Bearer API_KEY" -H "Content-Type: application/json" -d "{\"browser_id\":\"Browser_KEY\",\"command\":{\"type\":\"navigate\",\"url\":\"https://lp85d.ru/test/\"}}"
```

---

Порядок видимых полей на странице для `type_nth`:

| nth | Поле | Тип |
|-----|------|-----|
| 1 | Имя | text |
| 2 | Email | email |
| 3 | Пароль | password |
| 4 | Возраст | number |
| 5 | Комментарий | textarea |
