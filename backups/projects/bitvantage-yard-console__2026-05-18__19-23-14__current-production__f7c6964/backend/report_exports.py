import csv
from io import BytesIO, StringIO
from typing import Any, Dict, List
from xml.sax.saxutils import escape

try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
except ImportError:  # pragma: no cover - optional until dependency is installed
    colors = None
    TA_LEFT = TA_RIGHT = None
    A4 = landscape = None
    ParagraphStyle = getSampleStyleSheet = None
    mm = None
    Paragraph = SimpleDocTemplate = Spacer = Table = TableStyle = None


def build_operations_filename(report: Dict[str, Any], extension: str) -> str:
    filters = report.get("filters") or {}
    date_from = (filters.get("date_from") or "all-time").replace(":", "-")
    date_to = (filters.get("date_to") or date_from).replace(":", "-")
    operation_type = (filters.get("operation_type") or "all").lower()
    return f"operations-log_{date_from}_to_{date_to}_{operation_type}.{extension}"


def export_operations_csv(report: Dict[str, Any]) -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(
        [
            "performed_at_local",
            "performed_at_utc",
            "operation_type",
            "container_id",
            "container_type",
            "status",
            "direction",
            "bonded",
            "stack_out_date",
            "weight",
            "commodity",
            "line",
            "expeditor",
            "old_position_code",
            "new_position_code",
            "operator_username",
            "operator_full_name",
            "operator_role",
            "emergency_override",
            "override_reason",
        ]
    )
    for entry in report.get("items") or []:
        snapshot = entry.get("container_snapshot") or {}
        bonded_value = snapshot.get("bonded")
        bonded_label = "" if bonded_value is None else ("Yes" if bonded_value else "No")
        writer.writerow(
            [
                entry.get("performed_at_local") or "",
                entry.get("performed_at") or "",
                entry.get("operation_type") or "",
                entry.get("container_id") or "",
                snapshot.get("container_type") or "",
                snapshot.get("status") or "",
                snapshot.get("direction") or "",
                bonded_label,
                snapshot.get("stack_out_date") or "",
                snapshot.get("weight") if snapshot.get("weight") is not None else "",
                snapshot.get("commodity") or "",
                snapshot.get("line") or "",
                snapshot.get("expeditor") or "",
                entry.get("old_position_code") or "",
                entry.get("new_position_code") or "",
                entry.get("operator_username") or "",
                entry.get("operator_full_name") or "",
                entry.get("operator_role") or "",
                "Yes" if entry.get("emergency_override") else "No",
                entry.get("override_reason") or "",
            ]
        )
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def export_operations_pdf(report: Dict[str, Any]) -> bytes:
    if SimpleDocTemplate is None:
        raise RuntimeError("PDF export is unavailable because reportlab is not installed.")

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=11 * mm,
        rightMargin=11 * mm,
        topMargin=13 * mm,
        bottomMargin=11 * mm,
        title="BitVantage Operations Report",
    )
    styles = _build_pdf_styles()
    elements: List[Any] = []
    summary = report.get("summary") or {}
    filters = report.get("filters") or {}
    generated_at = report.get("generated_at_local") or report.get("generated_at") or "-"

    elements.append(Paragraph("BitVantage Operations Report", styles["title"]))
    elements.append(
        Paragraph(
            f"Period: {_safe(filters.get('date_from') or 'Start not set')} to {_safe(filters.get('date_to') or 'End not set')}",
            styles["subtitle"],
        )
    )
    elements.append(
        Paragraph(
            f"Generated: {_safe(generated_at)} | Filter: {_safe(filters.get('operation_type') or 'All operations')}",
            styles["meta"],
        )
    )
    elements.append(Spacer(1, 5 * mm))

    elements.append(
        Table(
            [
                ["Records", str(summary.get("total_records", 0)), "Containers", str(summary.get("unique_containers", 0))],
                ["Stack In", str(summary.get("stack_in", 0)), "Operators", str(summary.get("unique_users", 0))],
                ["Stack Out", str(summary.get("stack_out", 0)), "Restow", str(summary.get("restow", 0))],
            ],
            colWidths=[34 * mm, 32 * mm, 34 * mm, 32 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef4fb")),
                    ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#132238")),
                    ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9d7ea")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8e3f2")),
                    ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#f7fbff"), colors.HexColor("#edf4fc")]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            ),
        )
    )
    elements.append(Spacer(1, 5 * mm))

    operator_rows = [["Top operators", "Ops"]]
    operators = (summary.get("operators") or [])[:8]
    if operators:
        for operator in operators:
            label = operator.get("full_name") or operator.get("username") or "System"
            username = operator.get("username")
            if username:
                label = f"{label} (@{username})"
            operator_rows.append([label, str(operator.get("operations", 0))])
    else:
        operator_rows.append(["No operators in selected range", "0"])

    elements.append(
        Table(
            operator_rows,
            colWidths=[98 * mm, 18 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#132238")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9d7ea")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8e3f2")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f5f8fc")]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ]
            ),
        )
    )
    elements.append(Spacer(1, 6 * mm))

    table_rows: List[List[Any]] = [
        [
            Paragraph("Date / Time", styles["table_header"]),
            Paragraph("Operation", styles["table_header"]),
            Paragraph("Container", styles["table_header"]),
            Paragraph("Route", styles["table_header"]),
            Paragraph("Cargo", styles["table_header"]),
            Paragraph("Operator", styles["table_header"]),
            Paragraph("Override", styles["table_header"]),
        ]
    ]

    for entry in report.get("items") or []:
        snapshot = entry.get("container_snapshot") or {}
        container_meta = "<br/>".join(
            filter(
                None,
                [
                    f"<b>{_safe(entry.get('container_id') or '-')}</b>",
                    _safe(snapshot.get("container_type") or "-"),
                    _safe(snapshot.get("direction") or "-"),
                ],
            )
        )
        cargo_meta = "<br/>".join(
            filter(
                None,
                [
                    _safe(snapshot.get("status") or "-"),
                    _safe(snapshot.get("line") or "-"),
                    _safe(snapshot.get("commodity") or "-"),
                ],
            )
        )
        operator_meta = "<br/>".join(
            filter(
                None,
                [
                    _safe(entry.get("operator_full_name") or entry.get("operator_username") or "System"),
                    _safe((f"@{entry.get('operator_username')}" if entry.get("operator_username") else None) or ""),
                    _safe(entry.get("operator_role") or ""),
                ],
            )
        )
        override_meta = "No"
        if entry.get("emergency_override"):
            override_meta = "<br/>".join(
                [
                    "<b>Yes</b>",
                    _safe(entry.get("override_reason") or "Reason not recorded"),
                ]
            )
        table_rows.append(
            [
                Paragraph(_safe(entry.get("performed_at_local") or entry.get("performed_at") or "-").replace("T", "<br/>"), styles["table_cell"]),
                Paragraph(_safe(entry.get("operation_type") or "-"), styles["table_cell"]),
                Paragraph(container_meta, styles["table_cell"]),
                Paragraph(_build_route_markup(entry), styles["table_cell"]),
                Paragraph(cargo_meta, styles["table_cell"]),
                Paragraph(operator_meta, styles["table_cell"]),
                Paragraph(override_meta, styles["table_cell"]),
            ]
        )

    operations_table = Table(
        table_rows,
        repeatRows=1,
        colWidths=[29 * mm, 22 * mm, 31 * mm, 39 * mm, 36 * mm, 40 * mm, 54 * mm],
    )
    operations_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#132238")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9d7ea")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d8e3f2")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f6f9fd")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(operations_table)

    document.build(elements, onFirstPage=_draw_page_chrome, onLaterPages=_draw_page_chrome)
    return buffer.getvalue()


def _build_pdf_styles() -> Dict[str, ParagraphStyle]:
    stylesheet = getSampleStyleSheet()
    base = stylesheet["BodyText"]
    return {
        "title": ParagraphStyle(
            "ReportTitle",
            parent=base,
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=colors.HexColor("#132238"),
            spaceAfter=3,
        ),
        "subtitle": ParagraphStyle(
            "ReportSubtitle",
            parent=base,
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12,
            textColor=colors.HexColor("#36506f"),
            spaceAfter=2,
        ),
        "meta": ParagraphStyle(
            "ReportMeta",
            parent=base,
            fontSize=8.4,
            leading=10.4,
            textColor=colors.HexColor("#63758b"),
            spaceAfter=0,
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=base,
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=10,
            textColor=colors.white,
            alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=base,
            fontSize=7.6,
            leading=9.2,
            textColor=colors.HexColor("#16263b"),
            alignment=TA_LEFT,
        ),
        "footer": ParagraphStyle(
            "Footer",
            parent=base,
            fontSize=7.2,
            leading=9,
            textColor=colors.HexColor("#70829a"),
            alignment=TA_RIGHT,
        ),
    }


def _build_route_markup(entry: Dict[str, Any]) -> str:
    old_position = entry.get("old_position_code")
    new_position = entry.get("new_position_code")
    if old_position:
        return "<br/>".join([_safe(old_position), "to", _safe(new_position or "OUT")])
    return _safe(new_position or "IN")


def _draw_page_chrome(canvas, document) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6c7b8f"))
    canvas.drawRightString(document.pagesize[0] - document.rightMargin, 8 * mm, f"Page {document.page}")
    canvas.restoreState()


def _safe(value: Any) -> str:
    raw = "" if value is None else str(value)
    return escape(raw)
