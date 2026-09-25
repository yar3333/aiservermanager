# Соответствие HIP device ↔ PCI-шина (ROCm, AMD GPU)

Номера устройств в ROCm **не совпадают** между разными утилитами:
`rocm-smi GPU[0]` ≠ `HIP device 0` ≠ `/dev/dri/cardN`. Порядок HIP-нумерации
фиксируется ядром (KFD) при перечислении устройств и может меняться после
ребута, изменения слотов или правки PCIe. Перед запуском инференса
(llama-server, ComfyUI и т.п.) с привязкой к конкретным GPU — проверяйте
актуальный порядок.

## Основная команда (HIP device → PCI-шина)

HIP-номера — это порядок GPU-агентов в `rocminfo`. В выводе каждого GPU-агента
есть поле `BDFID` (число вида bus<<8 | dev<<3 | func), из которого вычисляется
PCI-адрес. Готовый one-liner:

```bash
rocminfo | awk '/^Agent [0-9]+/ {agent=$2} /Marketing Name:/ {name=substr($0, index($0,":")+2); gsub(/^[ \t]+|[ \t]+$/,"",name)} /BDFID:/ {bdf=$2+0; if (bdf>0) printf "HIP %d | Agent %s | 0000:%02x:%02x.%d | %s\n", hip++, agent, int(bdf/256)%256, int(bdf/8)%8, bdf%8, name}'
```

Пример вывода на этом сервере (2026-09-23):

```text
HIP 0 | Agent 2 | 0000:c3:00.0 | AMD Radeon RX 7900 XTX
HIP 1 | Agent 3 | 0000:c6:00.0 | AMD Radeon RX 7900 XTX
HIP 2 | Agent 4 | 0000:83:00.0 | AMD Radeon RX 7900 XTX
HIP 3 | Agent 5 | 0000:86:00.0 | AMD Radeon RX 7900 XTX
```

Именно эти номера (0,1,2,3) используются в `HIP_VISIBLE_DEVICES`,
`ROCR_VISIBLE_DEVICES` и `--device` у llama-server.

## Контрольные команды

**PCI-шины через rocm-smi** (свои индексы, НЕ HIP):

```bash
rocm-smi --showbus --showproductname
```

**PCI-шины через amd-smi** (тоже свои индексы):

```bash
amd-smi list
```

**Связь `/dev/dri/cardN` ↔ PCI** (card0 — это ASPEED AST2500, встроенная
графика BMC Supermicro H12SSL-i, не включать в список GPU):

```bash
for c in /sys/class/drm/card[0-9]; do printf '%s -> %s\n' "$c" "$(basename "$(readlink -f "$c/device")")"; done
```

**Все VGA-устройства AMD на шине:**

```bash
lspci -nn -d 1002::0300
```

## Сводная таблица этого сервера (актуальна на 2026-09-23)

| HIP device | rocminfo Agent | PCI-шина       | rocm-smi GPU | amd-smi GPU | card  | NUMA Node |
| ---------: | -------------: | -------------- | -----------: | ----------: | ----- | --------: |
|          0 |              2 | `0000:c3:00.0` |       GPU[2] |           2 | card1 |         1 |
|          1 |              3 | `0000:c6:00.0` |       GPU[3] |           3 | card2 |         2 |
|          2 |              4 | `0000:83:00.0` |       GPU[0] |           0 | card3 |         3 |
|          3 |              5 | `0000:86:00.0` |       GPU[1] |           1 | card4 |         4 |

Таблица построена перекрёстной проверкой: `rocminfo` (BDFID), `rocm-smi
--showbus` (Node ID совпадает с `rocminfo Node:`), `amd-smi list` (KFD_ID
совпадает с GUID в `rocm-smi --showproductname`) и `lspci`.

## Как правильно привязываться к GPU

Надёжнее всего — по **UUID**, а не по индексам: порядок индексов не
гарантирован между загрузками, UUID карты неизменен. UUID видно в
`amd-smi list` / `rocm-smi --showuuid` (для HIP 0/1/2/3 см. блоки `GPU: 2/3/0/1`
соответственно), а также в `rocminfo` в поле `Uuid:` каждого агента.
В `HIP_VISIBLE_DEVICES` / `ROCR_VISIBLE_DEVICES` можно передавать
последовательности вида `GPU-<uuid>`, которые переживают перестановку шин.

Быстрый способ после ребута — просто пересчитать one-liner выше и сравнить с
этой таблицей: если порядок совпадает, ничего менять не нужно.

# Описание

HIP-нумерация следует порядку, в котором драйвер amdgpu **пробил GPU в ядре**. Нумерация `/dev/dri` и `/sys/class/drm` присваивается в рамках того же probe, поэтому на этой машине всё совпадает — и это проверено по journal текущей загрузки:

Порядок probe (journal, 16:14): `c3 → c6 → 83 → 86`, строки `kfd kfd: added device` вплетены в тот же порядок — KFD-агенты (и, значит, HIP) регистрируются ровно в этой последовательности.

| HIP / torch.cuda | BDF     | /sys/class/drm | /dev/dri   |
| ---------------- | ------- | -------------- | ---------- |
| 0                | c3:00.0 | card1          | renderD128 |
| 1                | c6:00.0 | card2          | renderD129 |
| 2                | 83:00.0 | card3          | renderD130 |
| 3                | 86:00.0 | card4          | renderD131 |

(card0 = 43:00.0, ASPEED BMC — без render-узла и KFD-агента, не считается.)

Нюансы:

- **На практике читать текущий HIP-порядок можно по любому из них** — cardN или renderD127+N дают одинаковый результат, и оба совпадают с HIP.
- Но это не «HIP читает порядок /dev/dri»: миноры render-узлов назначает ядро при регистрации, udev-переименование (симлинки) нумерацию не изменит.
- Если после ребута порядок probe сменится, cardN, renderD и HIP для данной физической карты **сдвинутся вместе** — общая причина один, нумерации — симптомы. Поэтому сверять надо по BDF, а не по номерам.
- Единственное исключение — **rocm-smi/amd-smi**: они сортируют по BDF (у вас 83, 86, c3, c6), поэтому не совпадают ни с card, ни с renderD, ни с HIP — их как индикатор использовать нельзя.
