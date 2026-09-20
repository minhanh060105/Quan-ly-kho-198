const ExcelJS = require('exceljs');

/**
 * Xuất Báo cáo Nhập - Xuất - Tồn ra file Excel (.xlsx) chuẩn định dạng y tế
 */
async function generateInventoryReportExcel(data, fromDate, toDate) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Báo cáo Nhập Xuất Tồn');

  // Title Header
  worksheet.mergeCells('A1:L1');
  worksheet.getCell('A1').value = 'BỆNH VIỆN 198 - KHOA VI SINH';
  worksheet.getCell('A1').font = { name: 'Arial', size: 12, bold: true };

  worksheet.mergeCells('A2:L2');
  worksheet.getCell('A2').value = 'BÁO CÁO NHẬP - XUẤT - TỒN VẬT TƯ / HÓA CHẤT VI SINH';
  worksheet.getCell('A2').font = { name: 'Arial', size: 14, bold: true, color: { argb: '0F766E' } };
  worksheet.getCell('A2').alignment = { horizontal: 'center' };

  worksheet.mergeCells('A3:L3');
  worksheet.getCell('A3').value = `Từ ngày: ${fromDate || 'Tất cả'} - Đến ngày: ${toDate || 'Hiện tại'}`;
  worksheet.getCell('A3').font = { name: 'Arial', size: 10, italic: true };
  worksheet.getCell('A3').alignment = { horizontal: 'center' };

  // Headers
  worksheet.addRow([]); // Blank row
  const headerRow = worksheet.addRow([
    'STT',
    'Mã lô',
    'Mã vật tư',
    'Tên vật tư / Hóa chất',
    'Đơn vị tính',
    'Hạn sử dụng',
    'Tồn đầu kỳ', 'Nhập', 'Xuất', 'Điều chỉnh / Hoàn trả', 'Tồn cuối kỳ',
    'Trạng thái'
  ]);

  headerRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '0F766E' }
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Data rows
  data.forEach((item, index) => {
    const row = worksheet.addRow([
      index + 1,
      item.batch_code,
      item.item_code,
      item.item_name,
      item.unit,
      item.expiry_date,
      Number(item.opening_quantity), Number(item.import_quantity), Number(item.export_quantity), Number(item.adjustment_quantity), Number(item.closing_quantity),
      item.is_expired ? 'Hết hạn' : (item.is_near_expire ? 'Sắp hết hạn' : 'Còn hạn')
    ]);

    row.font = { name: 'Arial', size: 10 };
    row.getCell(7).alignment = { horizontal: 'right' };
    for (let col = 7; col <= 11; col++) row.getCell(col).numFmt = '#,##0.###';
  });

  // Column widths
  worksheet.columns = [
    { width: 6 },
    { width: 18 },
    { width: 15 },
    { width: 35 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 }, { width: 14 }, { width: 24 }, { width: 14 }, { width: 16 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = {
  generateInventoryReportExcel
};
