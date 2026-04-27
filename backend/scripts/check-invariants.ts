import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const stockRows = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      skuCode: true,
      stockQuantity: true,
      inventoryMovements: {
        select: {
          quantityChange: true
        }
      }
    }
  });

  const debtRows = await prisma.partner.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      currentDebt: true,
      arLedger: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          balanceAfter: true
        }
      }
    }
  });

  const stockDiffs = stockRows
    .map((row) => {
      const movementTotal = row.inventoryMovements.reduce((sum, item) => sum + Number(item.quantityChange), 0);
      const stockQuantity = Number(row.stockQuantity);
      return {
        skuCode: row.skuCode,
        stockQuantity,
        movementTotal
      };
    })
    .filter((row) => Math.abs(row.stockQuantity - row.movementTotal) > 0.0001);

  const debtDiffs = debtRows
    .map((row) => {
      const closingLedger = row.arLedger.length
        ? Number(row.arLedger[row.arLedger.length - 1].balanceAfter)
        : 0;
      const currentDebt = Number(row.currentDebt);
      return {
        code: row.code,
        name: row.name,
        currentDebt,
        closingLedger
      };
    })
    .filter((row) => Math.abs(row.currentDebt - row.closingLedger) > 0.0001);

  console.log(JSON.stringify({
    stockChecked: stockRows.length,
    debtChecked: debtRows.length,
    stockDiffs,
    debtDiffs
  }, null, 2));

  if (stockDiffs.length > 0 || debtDiffs.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
