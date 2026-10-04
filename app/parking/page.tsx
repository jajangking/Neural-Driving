import type { Metadata } from "next";
import ParkingView from "@/components/ParkingView";

export const metadata: Metadata = {
  title: "Neural Parking 3D — mobil belajar parkir sendiri",
  description:
    "Simulasi 3D mobil yang belajar parkir sendiri dengan neural network dan genetic algorithm.",
};

export default function ParkingPage() {
  return <ParkingView />;
}
