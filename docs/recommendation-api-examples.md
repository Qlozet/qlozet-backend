# Recommendation System API Examples

## 1. Home Feed Endpoint

### Request
```http
GET /recommend/feed?userId=user_12345&limit=10
```

### Response
```json
{
  "requestId": "a7b3c9d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
  "items": [
    {
      "itemId": "item_clothing_001",
      "position": 0,
      "stream": "clothing",
      "reasonCodes": ["STYLE_MATCH", "TRUSTED_VENDOR", "PRICE_FIT"],
      "explanations": [
        "Matches your minimalist aesthetic preference",
        "From a trusted vendor with 98% success rate",
        "Within your typical budget range"
      ],
      "name": "Linen Summer Dress",
      "price": 3500,
      "vendor": "vendor_xyz789",
      "type": "Garment",
      "tags": ["casual", "summer", "minimalist"],
      "images": ["https://cdn.example.com/dress1.jpg"]
    },
    {
      "itemId": "item_clothing_002",
      "position": 1,
      "stream": "clothing",
      "reasonCodes": ["AESTHETIC_MATCH", "FAST_ETA"],
      "explanations": [
        "Complements your wardrobe style",
        "Fast delivery available in your area"
      ],
      "name": "Cotton Palazzo Pants",
      "price": 2800,
      "vendor": "vendor_abc123",
      "type": "Garment",
      "tags": ["comfortable", "versatile"]
    },
    {
      "itemId": "item_accessory_003",
      "position": 2,
      "stream": "accessory",
      "reasonCodes": ["STYLE_MATCH", "TRENDING"],
      "explanations": [
        "Perfect match for your recent clothing purchases",
        "Trending in your style category"
      ],
      "name": "Leather Crossbody Bag",
      "price": 4200,
      "vendor": "vendor_def456",
      "type": "Accessory",
      "tags": ["leather", "crossbody", "minimalist"]
    },
    {
      "itemId": "item_clothing_004",
      "position": 3,
      "stream": "clothing",
      "reasonCodes": ["FIT_COMPATIBLE", "PRICE_FIT"],
      "explanations": [
        "Fits your body measurements perfectly",
        "Great value for quality"
      ],
      "name": "Tailored Blazer",
      "price": 5500,
      "vendor": "vendor_ghi789",
      "type": "Garment"
    },
    {
      "itemId": "item_clothing_005",
      "position": 4,
      "stream": "clothing",
      "reasonCodes": ["STYLE_MATCH", "TRUSTED_VENDOR"],
      "explanations": [
        "Aligns with your professional style",
        "Highly rated vendor"
      ],
      "name": "Silk Blouse",
      "price": 3200,
      "vendor": "vendor_xyz789",
      "type": "Garment"
    },
    {
      "itemId": "item_fabric_006",
      "position": 5,
      "stream": "fabric",
      "reasonCodes": ["AESTHETIC_MATCH", "QUALITY"],
      "explanations": [
        "Premium fabric matching your preferences",
        "High-quality material for custom designs"
      ],
      "name": "Premium Cotton Ankara",
      "price": 1800,
      "vendor": "vendor_jkl012",
      "type": "Fabric",
      "tags": ["ankara", "cotton", "vibrant"]
    }
  ]
}
```

---

## 2. Filtered Feed with Budget

### Request
```http
GET /recommend/feed?userId=user_12345&limit=10&budgetMax=3000&deadlineDays=7
```

### Response
```json
{
  "requestId": "b8c4d0e3-5f6a-7b8c-9d0e-1f2a3b4c5d6e",
  "items": [
    {
      "itemId": "item_clothing_010",
      "position": 0,
      "stream": "clothing",
      "reasonCodes": ["PRICE_FIT", "FAST_ETA", "STYLE_MATCH"],
      "explanations": [
        "Under your ₦3,000 budget",
        "Can be delivered within 7 days",
        "Matches your casual style"
      ],
      "name": "Cotton T-Shirt Dress",
      "price": 2500,
      "vendor": "vendor_quick123",
      "type": "Garment",
      "estimatedDeliveryDays": 3
    },
    {
      "itemId": "item_accessory_011",
      "position": 1,
      "stream": "accessory",
      "reasonCodes": ["PRICE_FIT", "TRENDING"],
      "explanations": [
        "Affordable and stylish",
        "Popular this season"
      ],
      "name": "Beaded Bracelet Set",
      "price": 1200,
      "vendor": "vendor_acc456",
      "type": "Accessory"
    },
    {
      "itemId": "item_clothing_012",
      "position": 2,
      "stream": "clothing",
      "reasonCodes": ["PRICE_FIT", "STYLE_MATCH"],
      "explanations": [
        "Great value under budget",
        "Complements your wardrobe"
      ],
      "name": "Denim Skirt",
      "price": 2800,
      "vendor": "vendor_denim789",
      "type": "Garment"
    }
  ]
}
```

---

## 3. Event Logging Examples

### Impression Event
```json
POST /events
{
  "userId": "user_12345",
  "eventType": "IMPRESSION",
  "properties": {
    "itemId": "item_clothing_001"
  },
  "context": {
    "surface": "home_feed",
    "requestId": "a7b3c9d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "position": 0,
    "stream": "clothing"
  },
  "metadata": {
    "reasonCodes": ["STYLE_MATCH", "TRUSTED_VENDOR", "PRICE_FIT"]
  },
  "timestamp": "2026-01-21T02:00:00.000Z"
}
```

### Click Event
```json
POST /events
{
  "userId": "user_12345",
  "eventType": "CLICK_ITEM",
  "properties": {
    "itemId": "item_clothing_001",
    "price": 3500
  },
  "context": {
    "surface": "home_feed",
    "requestId": "a7b3c9d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "position": 0
  },
  "timestamp": "2026-01-21T02:01:30.000Z"
}
```

### Add to Cart Event
```json
POST /events
{
  "userId": "user_12345",
  "eventType": "ADD_TO_CART",
  "properties": {
    "itemId": "item_clothing_001",
    "price": 3500,
    "quantity": 1
  },
  "context": {
    "surface": "product_detail",
    "requestId": "a7b3c9d2-4e5f-6a7b-8c9d-0e1f2a3b4c5d"
  },
  "timestamp": "2026-01-21T02:05:00.000Z"
}
```

### Purchase Event (Server-side auto-logged)
```json
{
  "userId": "user_12345",
  "eventType": "PURCHASE",
  "properties": {
    "itemId": "item_clothing_001",
    "businessId": "vendor_xyz789",
    "price": 3500,
    "quantity": 1
  },
  "context": {
    "surface": "server_hook",
    "requestId": "ORD-2026-001234"
  },
  "metadata": {
    "reasonCodes": ["ORDER_CREATED"]
  },
  "timestamp": "2026-01-21T02:10:00.000Z"
}
```

---

## 4. Mixed Feed Pattern

The system follows a **C-C-A-C-C-F** interleaving pattern:

```json
{
  "requestId": "...",
  "items": [
    { "position": 0, "stream": "clothing", "name": "Dress" },
    { "position": 1, "stream": "clothing", "name": "Pants" },
    { "position": 2, "stream": "accessory", "name": "Bag" },
    { "position": 3, "stream": "clothing", "name": "Blazer" },
    { "position": 4, "stream": "clothing", "name": "Blouse" },
    { "position": 5, "stream": "fabric", "name": "Ankara" },
    { "position": 6, "stream": "clothing", "name": "Skirt" },
    { "position": 7, "stream": "clothing", "name": "Jacket" },
    { "position": 8, "stream": "accessory", "name": "Shoes" },
    { "position": 9, "stream": "clothing", "name": "Shirt" }
  ]
}
```

---

## 5. Reason Codes Explained

| Reason Code | Meaning |
|------------|---------|
| `STYLE_MATCH` | Item matches user's style embedding (u_style) |
| `AESTHETIC_MATCH` | Item aligns with user's aesthetic preferences |
| `FIT_COMPATIBLE` | Item fits user's measurements (u_fit) |
| `TRUSTED_VENDOR` | Vendor has high success rate/featured status |
| `FAST_ETA` | Quick delivery available |
| `PRICE_FIT` | Within user's typical budget range |
| `TRENDING` | Popular item in category |
| `QUALITY` | High-quality material/construction |

---

## 6. Filter Drop-off Metrics (Debug)

When filters are applied, the system logs detailed metrics:

```json
{
  "total_input": 150,
  "dropped_vendor_gating": 12,
  "dropped_stock": 8,
  "dropped_price": 25,
  "dropped_blocked_vendor": 3,
  "dropped_demographic": 5,
  "dropped_category": 0,
  "total_output": 97
}
```

---

## 7. Integrity Check Output

Running `npm run integrity:check` produces:

```json
{
  "missingEmbeddings": {
    "count": 23,
    "status": "WARNING"
  },
  "vendorIssues": {
    "totalVendors": 45,
    "checked": 45,
    "invalidVendors": 2,
    "inactiveVendors": 5
  },
  "userCoverage": {
    "message": "User coverage check requires User Model direct access"
  }
}
```

---

## 8. Event Ingestion Stats

Logged every 100 events:

```
[Event Ingestion Stats]: {
  "IMPRESSION": 450,
  "CLICK_ITEM": 89,
  "ADD_TO_CART": 23,
  "PURCHASE": 8,
  "REMOVE_FROM_CART": 5,
  "WISHLIST_ADD": 12
}
```

---

## Key Features Demonstrated

✅ **Personalization**: Each recommendation includes reason codes explaining *why*  
✅ **Mixed Streams**: Balanced mix of clothing, accessories, and fabrics  
✅ **Vendor Diversity**: Max 2 items per vendor in top 10  
✅ **Budget Awareness**: Respects user's price constraints  
✅ **Delivery Speed**: Considers deadline requirements  
✅ **Trust Signals**: Highlights vendor quality metrics  
✅ **Tracking**: Full event pipeline with context preservation  
✅ **Observability**: Detailed metrics for monitoring and debugging
