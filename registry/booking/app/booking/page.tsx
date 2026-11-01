import { BookingPicker } from "@/components/pramaan/booking/booking-picker";
import { PageTitle } from "@/components/pramaan/parts";

export default function Page() {
  return (
    <div className="space-y-6">
      <PageTitle title="Book a time">Pick a time that suits you.</PageTitle>
      <BookingPicker />
    </div>
  );
}
