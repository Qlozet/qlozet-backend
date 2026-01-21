# Vendor-Centric Feed - Sample Output

## Request
```http
GET /recommend/vendors?userId=user_12345&limit=5&productsPerVendor=3
```

## Response
```json
{
  "requestId": "f9e8d7c6-b5a4-3210-9876-543210fedcba",
  "vendors": [
    {
      "vendorId": "vendor_xyz789",
      "vendorName": "Elegant Threads Boutique",
      "vendorScore": 0.92,
      "reasonCodes": ["TRUSTED_VENDOR", "FEATURED_VENDOR", "WIDE_SELECTION"],
      "explanations": [
        "98% success rate",
        "Featured vendor on platform",
        "Wide product selection"
      ],
      "successRate": 0.98,
      "isFeatured": true,
      "totalProducts": 45,
      "products": [
        {
          "itemId": "item_clothing_001",
          "position": 0,
          "stream": "clothing",
          "reasonCodes": ["STYLE_MATCH", "PRICE_FIT"],
          "explanations": [
            "Matches your minimalist aesthetic",
            "Within your budget range"
          ],
          "name": "Linen Summer Dress",
          "price": 3500,
          "vendor": "vendor_xyz789"
        },
        {
          "itemId": "item_clothing_005",
          "position": 1,
          "stream": "clothing",
          "reasonCodes": ["AESTHETIC_MATCH", "QUALITY"],
          "explanations": [
            "Aligns with your professional style",
            "Premium quality fabric"
          ],
          "name": "Silk Blouse",
          "price": 3200,
          "vendor": "vendor_xyz789"
        },
        {
          "itemId": "item_accessory_008",
          "position": 2,
          "stream": "accessory",
          "reasonCodes": ["STYLE_MATCH"],
          "explanations": [
            "Complements your wardrobe"
          ],
          "name": "Minimalist Watch",
          "price": 4500,
          "vendor": "vendor_xyz789"
        }
      ]
    },
    {
      "vendorId": "vendor_abc123",
      "vendorName": "Urban Chic Fashion",
      "vendorScore": 0.85,
      "reasonCodes": ["TRUSTED_VENDOR", "PREVIOUS_PURCHASE"],
      "explanations": [
        "95% success rate",
        "You've shopped here before"
      ],
      "successRate": 0.95,
      "isFeatured": false,
      "totalProducts": 32,
      "products": [
        {
          "itemId": "item_clothing_002",
          "position": 0,
          "stream": "clothing",
          "reasonCodes": ["AESTHETIC_MATCH", "FAST_ETA"],
          "explanations": [
            "Complements your wardrobe style",
            "Fast delivery available"
          ],
          "name": "Cotton Palazzo Pants",
          "price": 2800,
          "vendor": "vendor_abc123"
        },
        {
          "itemId": "item_clothing_012",
          "position": 1,
          "stream": "clothing",
          "reasonCodes": ["STYLE_MATCH"],
          "explanations": [
            "Matches your casual style"
          ],
          "name": "Denim Jacket",
          "price": 4200,
          "vendor": "vendor_abc123"
        },
        {
          "itemId": "item_fabric_015",
          "position": 2,
          "stream": "fabric",
          "reasonCodes": ["QUALITY", "TRENDING"],
          "explanations": [
            "Premium quality material",
            "Popular this season"
          ],
          "name": "Ankara Print Fabric",
          "price": 1800,
          "vendor": "vendor_abc123"
        }
      ]
    },
    {
      "vendorId": "vendor_def456",
      "vendorName": "Artisan Accessories Co.",
      "vendorScore": 0.78,
      "reasonCodes": ["WIDE_SELECTION"],
      "explanations": [
        "Wide product selection"
      ],
      "successRate": 0.88,
      "isFeatured": false,
      "totalProducts": 28,
      "products": [
        {
          "itemId": "item_accessory_003",
          "position": 0,
          "stream": "accessory",
          "reasonCodes": ["STYLE_MATCH", "TRENDING"],
          "explanations": [
            "Perfect match for your style",
            "Trending in your category"
          ],
          "name": "Leather Crossbody Bag",
          "price": 4200,
          "vendor": "vendor_def456"
        },
        {
          "itemId": "item_accessory_018",
          "position": 1,
          "stream": "accessory",
          "reasonCodes": ["AESTHETIC_MATCH"],
          "explanations": [
            "Complements your aesthetic"
          ],
          "name": "Statement Earrings",
          "price": 1500,
          "vendor": "vendor_def456"
        },
        {
          "itemId": "item_accessory_022",
          "position": 2,
          "stream": "accessory",
          "reasonCodes": ["PRICE_FIT"],
          "explanations": [
            "Great value"
          ],
          "name": "Beaded Bracelet Set",
          "price": 1200,
          "vendor": "vendor_def456"
        }
      ]
    }
  ]
}
```

## Key Features

✅ **Vendor Ranking**: Vendors scored by trust (40%), style match (30%), user history (30%)  
✅ **Product Curation**: Each vendor shows their top 3-5 products  
✅ **Trust Signals**: Success rate, featured status, total products displayed  
✅ **Personalization**: Products matched to user's style preferences  
✅ **Explanations**: Both vendor-level and product-level reason codes  

## Use Cases

1. **Discover New Vendors**: Find trusted businesses matching your style
2. **Vendor Spotlight**: Give each vendor equal visibility
3. **Shop by Vendor**: Browse products grouped by their seller
4. **Trust-Based Discovery**: Prioritize high-quality, reliable vendors
