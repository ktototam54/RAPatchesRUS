# convert_to_1251.py
# -*- coding: utf-8 -*-
"""
Конвертирует CSV-файл (в формате msgstringtable.csv) из UTF-8 в Windows-1251,
сохраняя структуру "KEY,BASE64(VALUE)".
"""

import base64
import csv
import sys

INPUT_FILE  = "msgstringtable.csv"
OUTPUT_FILE = "msgstringtable_1251.csv"

def convert(input_path: str, output_path: str) -> None:
    with open(input_path, "r", encoding="utf-8", newline="") as fin, \
         open(output_path, "w", encoding="cp1251", newline="", errors="replace") as fout:

        reader = csv.reader(fin)
        writer = csv.writer(fout, lineterminator="\n")

        for row in reader:
            if not row:
                writer.writerow(row)
                continue

            new_row = []
            for cell in row:
                try:
                    # Пытаемся декодировать как base64
                    decoded = base64.b64decode(cell, validate=True)
                    # Пробуем прочитать как UTF-8 (в исходнике текст в UTF-8)
                    text = decoded.decode("utf-8")
                    # Перекодируем в CP1251 и обратно в base64
                    new_cell = base64.b64encode(text.encode("cp1251")).decode("ascii")
                    new_row.append(new_cell)
                except Exception:
                    # Не base64 или не текст — оставляем как есть
                    new_row.append(cell)

            writer.writerow(new_row)

    print(f"Готово: {output_path}")

if __name__ == "__main__":
    convert(INPUT_FILE, OUTPUT_FILE)