"""
PaddleOCR 微服務
提供發票 OCR 文字辨識 API
"""
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR
import numpy as np
from PIL import Image
import io
import logging
from typing import List, Dict
import re

# 設定日誌 - 強制輸出到 stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartLedger OCR Service", version="1.0.0")

# CORS 設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化 PaddleOCR (使用繁體中文模型)
# use_angle_cls=True 支援文字方向識別
ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)

logger.info("PaddleOCR 服務已啟動")


@app.get("/health")
async def health_check():
    """健康檢查端點"""
    return {"status": "healthy", "service": "paddleocr"}


@app.post("/api/ocr/extract")
async def extract_text(file: UploadFile = File(...)):
    """
    OCR 文字辨識端點
    
    參數:
        file: 上傳的圖片檔案 (jpg, png, webp)
    
    回傳:
        {
            "success": true,
            "texts": [
                {
                    "text": "辨識的文字",
                    "confidence": 0.95,
                    "bbox": [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
                }
            ]
        }
    """
    try:
        # 驗證檔案類型
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="只支援圖片檔案")
        
        # 讀取圖片
        logger.info(f"開始處理圖片: {file.filename}")
        image_bytes = await file.read()
        
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="圖片檔案為空")
        
        # 轉換為 PIL Image
        try:
            image = Image.open(io.BytesIO(image_bytes))
            # 轉換為 RGB 模式
            if image.mode != 'RGB':
                image = image.convert('RGB')
            image_array = np.array(image)
        except Exception as e:
            logger.error(f"圖片解析失敗: {str(e)}")
            raise HTTPException(status_code=400, detail="無法解析圖片檔案")
        
        # OCR 辨識
        logger.info(f"圖片尺寸: {image_array.shape}")
        result = ocr.ocr(image_array, cls=True)
        
        if not result or not result[0]:
            logger.warning("OCR 未辨識到任何文字")
            return {
                "success": True,
                "texts": [],
                "message": "未辨識到文字"
            }
        
        # 格式化結果
        texts = []
        for line in result[0]:
            if line and len(line) >= 2:
                bbox, (text, confidence) = line[0], line[1]
                texts.append({
                    "text": text,
                    "confidence": float(confidence),
                    "bbox": bbox
                })
        
        logger.info(f"成功辨識 {len(texts)} 行文字")
        
        return {
            "success": True,
            "texts": texts
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OCR 處理失敗: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"OCR 處理失敗: {str(e)}")


@app.post("/api/ocr/invoice")
async def parse_invoice(file: UploadFile = File(...)):
    """
    發票解析端點 (OCR + 智慧解析)
    
    參數:
        file: 上傳的發票圖片
    
    回傳:
        {
            "success": true,
            "data": {
                "date": "2025-10-18",
                "amount": 350.0,
                "merchant": "全家便利商店",
                "items": ["咖啡", "麵包"],
                "invoiceNumber": "AB-12345678"
            }
        }
    """
    try:
        # 驗證檔案類型
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="只支援圖片檔案")
        
        # 先進行 OCR 辨識
        logger.info(f"開始解析發票: {file.filename}")
        image_bytes = await file.read()
        
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="圖片檔案為空")
        
        # 轉換為 PIL Image
        try:
            image = Image.open(io.BytesIO(image_bytes))
            # 轉換為 RGB 模式
            if image.mode != 'RGB':
                image = image.convert('RGB')
            image_array = np.array(image)
        except Exception as e:
            logger.error(f"圖片解析失敗: {str(e)}")
            raise HTTPException(status_code=400, detail="無法解析圖片檔案")
        
        # OCR 辨識
        logger.info(f"圖片尺寸: {image_array.shape}")
        result = ocr.ocr(image_array, cls=True)
        
        if not result or not result[0]:
            return {
                "success": False,
                "error": "無法辨識發票內容"
            }
        
        # 提取文字並解析
        texts = [line[1][0] for line in result[0]]
        
        # 使用 print 強制輸出（確保能看到日誌）
        print("\n" + "=" * 60)
        print(f"OCR 辨識到 {len(texts)} 行文字")
        print("完整 OCR 辨識結果:")
        for i, text in enumerate(texts):
            print(f"  行 {i:2d}: {text}")
        print("=" * 60 + "\n")
        
        logger.info(f"OCR 辨識到 {len(texts)} 行文字")
        logger.info("=" * 60)
        logger.info("完整 OCR 辨識結果:")
        for i, text in enumerate(texts):
            logger.info(f"  行 {i:2d}: {text}")
        logger.info("=" * 60)
        
        # 解析發票資訊
        invoice_data = parse_invoice_texts(texts)
        
        logger.info(f"發票解析完成: {invoice_data}")
        
        return {
            "success": True,
            "data": invoice_data
        }
        
    except Exception as e:
        logger.error(f"發票解析失敗: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"發票解析失敗: {str(e)}")


def parse_invoice_texts(texts: List[str]) -> Dict:
    """
    從 OCR 文字中解析發票資訊
    
    解析規則:
    - 日期: 尋找 YYYY/MM/DD 或 YYYY-MM-DD 格式
    - 金額: 使用多重策略智慧搜尋
    - 商家: 通常在發票頂部，較大字體
    - 發票號碼: AB-12345678 格式
    """
    from datetime import datetime
    
    invoice_data = {
        "date": None,
        "amount": None,
        "merchant": None,
        "items": [],
        "invoiceNumber": None
    }
    
    # 正規表達式
    date_patterns = [
        # 優先匹配西元年 (4位數) - 最可靠
        # OCR 錯誤：日期和時間黏在一起 (例如: 2025-10-1420:39:38)
        r'(\d{4})[年/\-](\d{1,2})[月/\-](\d{1,2})(?:\d{2}:\d{2})',  # 2025-10-1420:39 (最優先)
        r'(\d{4})[年/\-](\d{1,2})[月/\-](\d{1,2})[\s日]',  # 2025年10月18日 or 2025/10/18 (有空格或「日」)
        r'(\d{4})[年/\-](\d{1,2})[月/\-](\d{1,2})(?![0-9月])',  # 2025-10-18 (後面不能是數字或「月」)
        # 民國年 (3位數) - 較不可靠，最後才匹配
        r'(\d{3})[年/\-](\d{1,2})[月/\-](\d{1,2})[\s日]',  # 114/10/18 (民國年，有空格或「日」)
        r'(\d{3})[年/\-](\d{1,2})[月/\-](\d{1,2})(?![0-9月])',  # 114-10-18 (民國年，後面不能是數字或「月」)
    ]
    amount_pattern = r'\$?\s*(\d{1,3}(?:,?\d{3})*(?:\.\d{1,2})?)'
    invoice_number_pattern = r'([A-Z]{2}[\-\s]?\d{8})'
    tax_id_pattern = r'(?<!\d)\d{8}(?!\d)'  # 8 位數字的統一編號
    
    # 統一編號相關關鍵字
    tax_id_keywords = ['統一編號', '統編', '賣方統編', '買方統編', 'Tax ID', 'TAX ID']
    
    # 收集所有可能的金額
    amount_candidates = []
    
    # 解析每行文字
    for i, text in enumerate(texts):
        # 1. 解析日期
        if not invoice_data["date"]:
            for pattern in date_patterns:
                match = re.search(pattern, text)
                if match:
                    year = int(match.group(1))
                    month = int(match.group(2))
                    day = int(match.group(3))
                    
                    print(f"[日期匹配] 行 {i}: {text}")
                    print(f"  原始匹配: 年={year}, 月={month}, 日={day}")
                    
                    # 處理民國年 (轉西元年)
                    if year < 1000:
                        year += 1911
                        print(f"  轉換民國年: {year}")
                    
                    try:
                        invoice_data["date"] = f"{year}-{month:02d}-{day:02d}"
                        print(f"✓ 最終日期: {invoice_data['date']} (行 {i})")
                        logger.info(f"✓ 找到日期: {invoice_data['date']} (行 {i})")
                        break
                    except:
                        pass
        
        # 2. 收集所有可能的金額 (擴充關鍵字清單 + OCR 常見錯誤)
        amount_keywords = [
            # 繁體字
            '總計', '合計', '應收', '金額', '小計', '實收', '應付',
            '總額', '共計', '計',
            # 簡體字 (OCR 可能誤判)
            '总计', '合计', '应收', '金额', '小计', '实收', '应付',
            '总额', '共计', '计',
            # 英文
            'Total', 'TOTAL', 'total', 'Amount', 'AMOUNT', 'Sum', 'Cash',
            # 符號
            'NT$', '$', '現金', '现金'
        ]
        
        # 策略 1: 關鍵字行及前後 2 行搜尋
        if any(keyword in text for keyword in amount_keywords):
            print(f"✓ 找到金額關鍵字: {text} (行 {i})")
            logger.info(f"✓ 找到金額關鍵字: {text} (行 {i})")
            # 搜尋當前行及前後 2 行
            search_range = range(max(0, i-2), min(len(texts), i+3))
            for j in search_range:
                line_text = texts[j]
                
                # 排除包含統一編號關鍵字的行
                if any(kw in line_text for kw in tax_id_keywords):
                    print(f"  ✗ 跳過統編行: {line_text} (行 {j})")
                    logger.info(f"  ✗ 跳過統編行: {line_text} (行 {j})")
                    continue
                
                amounts = re.findall(amount_pattern, line_text)
                for amt_str in amounts:
                    try:
                        amt = float(amt_str.replace(',', ''))
                        
                        # 更嚴格的統編過濾：
                        # 1. 排除 7-8 位數字（統編格式）
                        digits_only = amt_str.replace(',', '').replace('.', '')
                        if 7 <= len(digits_only) <= 8 and '.' not in amt_str:
                            print(f"  ✗ 跳過疑似統編(7-8位): {amt} (行 {j})")
                            logger.info(f"  ✗ 跳過疑似統編(7-8位): {amt} (行 {j})")
                            continue
                        
                        # 2. 排除過大的數字（> 1000萬，很可能是統編或其他編號）
                        if amt >= 10000000:
                            print(f"  ✗ 跳過過大數字(>1000萬): {amt} (行 {j})")
                            logger.info(f"  ✗ 跳過過大數字(>1000萬): {amt} (行 {j})")
                            continue
                        
                        # 3. 發票金額通常在合理範圍 (1 ~ 100000)
                        if 1 <= amt <= 100000:
                            # 優先級策略：關鍵字所在行 > 前後行
                            # 優先級 5: 關鍵字所在行（最高）
                            # 優先級 3: 關鍵字前後 2 行
                            priority = 5 if j == i else 3
                            amount_candidates.append({
                                'value': amt,
                                'line': j,
                                'text': line_text,
                                'priority': priority
                            })
                            print(f"  ✓ 候選金額: {amt} (行 {j}, 優先級 {priority})")
                            logger.info(f"  候選金額: {amt} (行 {j}, 優先級 {priority})")
                    except:
                        pass
        
        # 策略 2: 全文搜尋所有金額 (作為後備)
        # 排除統一編號相關的行
        if not any(kw in text for kw in tax_id_keywords):
            amounts = re.findall(amount_pattern, text)
            for amt_str in amounts:
                try:
                    amt = float(amt_str.replace(',', ''))
                    
                    # 更嚴格的統編過濾：
                    # 1. 排除 7-8 位數字（統編格式）
                    digits_only = amt_str.replace(',', '').replace('.', '')
                    if 7 <= len(digits_only) <= 8 and '.' not in amt_str:
                        continue
                    
                    # 2. 排除過大的數字（> 1000萬）
                    if amt >= 10000000:
                        continue
                    
                    # 3. 發票金額合理範圍 (10 ~ 100000)
                    if 10 <= amt <= 100000:
                        # 排除發票號碼中的數字
                        if not re.search(invoice_number_pattern, text):
                            amount_candidates.append({
                                'value': amt,
                                'line': i,
                                'text': text,
                                'priority': 1  # 一般搜尋優先級低
                            })
                except:
                    pass
        
        # 3. 解析發票號碼
        if not invoice_data["invoiceNumber"]:
            match = re.search(invoice_number_pattern, text)
            if match:
                invoice_data["invoiceNumber"] = match.group(1).replace(' ', '-')
                logger.info(f"✓ 找到發票號碼: {invoice_data['invoiceNumber']} (行 {i})")
        
        # 4. 解析商家名稱 (通常在前 3 行，且長度適中)
        if not invoice_data["merchant"] and i < 3:
            # 排除日期、發票號碼、數字開頭的文字
            if (len(text) >= 3 and len(text) <= 30 and
                not re.match(r'^\d', text) and
                not re.search(date_patterns[0], text) and
                not re.search(invoice_number_pattern, text)):
                invoice_data["merchant"] = text.strip()
                logger.info(f"✓ 找到商家: {invoice_data['merchant']} (行 {i})")
    
    # 智慧選擇金額
    print("\n" + "=" * 60)
    print(f"共找到 {len(amount_candidates)} 個候選金額")
    
    if amount_candidates:
        # 顯示所有候選金額
        print("所有候選金額清單:")
        for idx, cand in enumerate(amount_candidates):
            print(f"  [{idx+1}] 金額: {cand['value']}, 行: {cand['line']}, 優先級: {cand['priority']}")
            print(f"      文字: {cand['text']}")
        
        # 先按優先級排序，再按金額大小
        sorted_candidates = sorted(amount_candidates, key=lambda x: (-x['priority'], -x['value']))
        
        # 選擇優先級最高且金額最大的
        selected = sorted_candidates[0]
        invoice_data["amount"] = selected['value']
        print("=" * 60)
        print(f"✓ 最終選擇: 金額 {selected['value']}")
        print(f"  行號: {selected['line']}")
        print(f"  優先級: {selected['priority']}")
        print(f"  來源文字: {selected['text']}")
        print("=" * 60 + "\n")
    
    logger.info("=" * 60)
    logger.info(f"共找到 {len(amount_candidates)} 個候選金額")
    
    if amount_candidates:
        # 顯示所有候選金額
        logger.info("所有候選金額清單:")
        for idx, cand in enumerate(amount_candidates):
            logger.info(f"  [{idx+1}] 金額: {cand['value']}, 行: {cand['line']}, 優先級: {cand['priority']}")
            logger.info(f"      文字: {cand['text']}")
        
        # 先按優先級排序，再按金額大小
        sorted_candidates = sorted(amount_candidates, key=lambda x: (-x['priority'], -x['value']))
        
        # 選擇優先級最高且金額最大的
        selected = sorted_candidates[0]
        logger.info("=" * 60)
        logger.info(f"✓ 最終選擇: 金額 {selected['value']}")
        logger.info(f"  行號: {selected['line']}")
        logger.info(f"  優先級: {selected['priority']}")
        logger.info(f"  來源文字: {selected['text']}")
        logger.info("=" * 60)
    
    # 設定預設值
    if not invoice_data["date"]:
        invoice_data["date"] = datetime.now().strftime("%Y-%m-%d")
        logger.warning("✗ 未找到日期，使用當前日期")
    
    if not invoice_data["amount"]:
        invoice_data["amount"] = 0
        logger.warning("✗ 未找到金額")
    
    if not invoice_data["merchant"]:
        invoice_data["merchant"] = "未知商家"
        logger.warning("✗ 未找到商家名稱")
    
    return invoice_data


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
